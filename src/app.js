import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, isHash, keccak256, toBytes } from 'viem';
import { askEarl, HISTORY_TURNS, lessonFrom, TRICK_REPLY, validateMessage } from './game.js';
import { askReferee, askWinCheck } from './referee.js';

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * The game pipeline: commit a message, read the paid attempt from the chain,
 * ask Earl, have the referee check his reply, and pay the pot if he cracked.
 * Every step that touches Earl or the payout runs one at a time, so two
 * winners can never race each other.
 */
export function createGame({
  llm, chain, store, reasoningEffort = 'medium', refereeEffort = 'medium', log = console,
}) {
  let queue = Promise.resolve();
  const serial = fn => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  // Records are ordered by `at`, so no two may share one, even within a millisecond.
  let lastAt = store.attempts({ limit: 1 })[0]?.at ?? 0;
  const stamp = () => (lastAt = Math.max(Date.now(), lastAt + 1));

  function prepare({ player, text }) {
    if (typeof player !== 'string' || !isAddress(player, { strict: false })) throw new UserError('Connect a wallet first.');
    const problem = validateMessage(text);
    if (problem) throw new UserError(problem);
    const msgHash = keccak256(toBytes(`${randomBytes(16).toString('hex')}\n${text}`));
    store.addPending(msgHash, { player: getAddress(player), text });
    return { msgHash };
  }

  // This player's earlier turns in the round, oldest first, as Earl and the referee see them.
  // Blocked turns are left out: resending their text would get every later message blocked too.
  function historyBefore({ round, player, at }) {
    return store.attempts({ round, player })
      .filter(a => a.at < at && !a.blocked)
      .reverse()
      .slice(-HISTORY_TURNS);
  }

  // Each win becomes something Earl is told to be ready for in later rounds, oldest first.
  function lessonsBefore(round) {
    return store.attempts()
      .filter(a => a.round < round && a.payout === 'paid')
      .reverse()
      .map(lessonFrom);
  }

  // A sworn fact can only win once: the ones that beat Earl in earlier rounds no longer count.
  function retiredBefore(round) {
    return [...new Set(store.attempts()
      .filter(a => a.round < round && a.payout === 'paid' && a.crack?.otherRef?.startsWith('B'))
      .map(a => a.crack.otherRef))];
  }

  // A cracked attempt is saved before the payout, so a failed payout is retried
  // instead of asking Earl again (he might not crack twice).
  async function settle(record) {
    try {
      // A payout whose receipt timed out may still have landed.
      record.crackTx = await chain.findCrack(record.msgHash, record.block)
        ?? (await chain.currentRound() === record.round
          ? await chain.crack(record.player, record.msgHash)
          : undefined);
      record.payout = record.crackTx ? 'paid' : 'too-late';
      delete record.payoutError;
    } catch (error) {
      record.payout = 'pending';
      record.payoutError = error.shortMessage ?? error.message;
      log.error(`payout for ${record.msgHash} failed: ${record.payoutError}`);
    }
    store.saveAttempt(record);
    return record;
  }

  function process(attempt) {
    return serial(async () => {
      const done = store.attempt(attempt.msgHash);
      if (done) return done;
      const pending = store.pending(attempt.msgHash);
      if (!pending) return null;
      // Only the wallet that wrote the message can pay for it. Anyone who copies
      // a hash from the mempool and pays first gets nothing for it.
      if (pending.player !== getAddress(attempt.player)) {
        log.warn(`attempt ${attempt.msgHash} paid by ${attempt.player}, written by ${pending.player}`);
        return null;
      }
      const at = stamp();
      const earl = await askEarl(llm, {
        round: attempt.round,
        history: historyBefore({ round: attempt.round, player: pending.player, at }),
        text: pending.text,
        lessons: lessonsBefore(attempt.round),
        reasoningEffort,
      });
      const record = {
        ...attempt, player: pending.player, text: pending.text,
        reply: earl.reply, conceded: earl.conceded, model: earl.model, at,
        ...(earl.blocked && { blocked: true }),
      };
      if (earl.blocked) {
        store.saveAttempt(record);
        return record;
      }
      // Saved before the review runs, so an outage is retried without asking Earl again.
      record.review = 'pending';
      store.saveAttempt(record);
      return review(record);
    });
  }

  async function review(record) {
    try {
      const history = historyBefore(record);
      const found = !record.conceded && await askReferee(llm, {
        earlier: history.map(a => a.reply),
        latest: record.reply,
        retired: retiredBefore(record.round),
        reasoningEffort: refereeEffort,
      });
      if (record.conceded || found) {
        const stands = await askWinCheck(llm, {
          messages: [...history.map(a => a.text), record.text],
          reply: record.reply,
          reasoningEffort: refereeEffort,
        });
        if (stands) {
          const crack = found ? { by: 'contradiction', ...found } : { by: 'concession' };
          Object.assign(record, { crack, payout: 'pending' });
        } else {
          log.warn(`win refused on ${record.msgHash}: reply was ${record.reply}`);
          // Blocked turns stay out of the history, so the trick cannot carry into his next reply.
          Object.assign(record, { reply: TRICK_REPLY, conceded: false, blocked: true });
        }
      }
      record.review = 'done';
    } catch (error) {
      log.error(`referee failed on ${record.msgHash}: ${error.message}`);
    }
    store.saveAttempt(record);
    return record.payout === 'pending' ? settle(record) : record;
  }

  async function submit(txHash) {
    if (typeof txHash !== 'string' || !isHash(txHash)) throw new UserError('Send a transaction hash.');
    const attempts = await chain.attemptsInTx(txHash);
    if (!attempts.length) throw new UserError('That transaction has no attempt in it.');
    let result = null;
    for (const attempt of attempts) {
      try {
        result ??= await process(attempt);
      } catch (error) {
        log.error(`Earl failed on ${attempt.msgHash}: ${error.message}`);
        throw new UserError('Earl is busy. Your message is paid for and saved, and he will answer it shortly.', 503);
      }
    }
    if (!result) throw new UserError('This message was not written from the wallet that paid for it.');
    return result;
  }

  /** Catch attempts the browser never reported, and retry pending reviews and payouts. */
  async function sweep() {
    const { attempts, toBlock } = await chain.attemptsSince(store.lastBlock);
    let safeBlock = toBlock;
    for (const attempt of attempts) {
      try {
        await process(attempt);
      } catch (error) {
        log.error(`sweep: Earl failed on ${attempt.msgHash}: ${error.message}`);
        safeBlock = Math.min(safeBlock, attempt.block - 1);
      }
    }
    store.lastBlock = safeBlock;
    // A submit running alongside may finish a record first, so check again once it is our turn.
    for (const record of store.attempts().filter(r => r.review === 'pending').reverse()) {
      await serial(() => (record.review === 'pending' ? review(record) : record));
    }
    for (const record of store.attempts().filter(r => r.payout === 'pending')) {
      await serial(() => (record.payout === 'pending' ? settle(record) : record));
    }
  }

  // Text the provider blocked and tricks the win check threw out stay out of the public case files.
  const shown = record => (record.blocked ? { ...record, text: '(message hidden: blocked)' } : record);

  async function state() {
    const current = await chain.state();
    return { ...current, retired: retiredBefore(current.round), recent: store.attempts({ limit: 30 }).map(shown) };
  }

  function round(n) {
    return store.attempts({ round: n }).reverse().map(shown);
  }

  return { prepare, submit, sweep, state, round };
}
