import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, isHash, keccak256, toBytes } from 'viem';
import { askEarl, validateMessage } from './game.js';

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * The game pipeline: commit a message, read the paid attempt from the chain,
 * ask Earl, and pay the pot if he concedes. Every step that touches Earl or
 * the payout runs one at a time, so two winners can never race each other.
 */
export function createGame({ llm, chain, store, reasoningEffort = 'medium', log = console }) {
  let queue = Promise.resolve();
  const serial = fn => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  function prepare({ player, text }) {
    if (typeof player !== 'string' || !isAddress(player, { strict: false })) throw new UserError('Connect a wallet first.');
    const problem = validateMessage(text);
    if (problem) throw new UserError(problem);
    const msgHash = keccak256(toBytes(`${randomBytes(16).toString('hex')}\n${text}`));
    store.addPending(msgHash, { player: getAddress(player), text });
    return { msgHash };
  }

  // A conceded attempt is saved before the payout, so a failed payout is retried
  // instead of asking Earl again (he might not concede twice).
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
      const history = store.attempts({ round: attempt.round, player: pending.player }).reverse();
      const earl = await askEarl(llm, { round: attempt.round, history, text: pending.text, reasoningEffort });
      const record = {
        ...attempt, player: pending.player, text: pending.text,
        reply: earl.reply, conceded: earl.conceded, model: earl.model, at: Date.now(),
      };
      if (!earl.conceded) {
        store.saveAttempt(record);
        return record;
      }
      record.payout = 'pending';
      store.saveAttempt(record);
      return settle(record);
    });
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

  /** Catch attempts the browser never reported, and retry pending payouts. */
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
    for (const record of store.attempts().filter(r => r.payout === 'pending')) {
      await serial(() => settle(record));
    }
  }

  async function state() {
    return { ...await chain.state(), recent: store.attempts({ limit: 30 }) };
  }

  function round(n) {
    return store.attempts({ round: n }).reverse();
  }

  return { prepare, submit, sweep, state, round };
}
