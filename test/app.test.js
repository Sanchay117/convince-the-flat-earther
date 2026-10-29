import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame } from '../src/app.js';
import { Store } from '../src/store.js';

const ALICE = '0x00000000000000000000000000000000000A11cE';
const BOB = '0x0000000000000000000000000000000000000B0b';
const quiet = { warn() {}, error() {} };

function fakeChain() {
  const chain = {
    round: 1, block: 100, txs: new Map(), cracks: [], crackFails: 0, landed: new Map(),
    pay(player, msgHash) {
      const txHash = `0x${String(chain.txs.size + 1).padStart(64, '0')}`;
      chain.txs.set(txHash, [{ round: chain.round, player, msgHash, paid: '1000', burned: '300',
        txHash, block: ++chain.block }]);
      return txHash;
    },
    async attemptsInTx(txHash) { return chain.txs.get(txHash) ?? []; },
    async attemptsSince(after) {
      const attempts = [...chain.txs.values()].flat().filter(a => after == null || a.block > after);
      return { attempts, toBlock: chain.block };
    },
    async currentRound() { return chain.round; },
    async findCrack(msgHash) { return chain.landed.get(msgHash) ?? null; },
    async crack(winner, msgHash) {
      if (chain.crackFails-- > 0) throw new Error('rpc down');
      chain.cracks.push({ winner, msgHash });
      chain.round++;
      const hash = `0xc${String(chain.cracks.length).padStart(63, '0')}`;
      chain.landed.set(msgHash, hash);
      return hash;
    },
    async state() { return { round: chain.round }; },
  };
  return chain;
}

function fakeLlm(verdicts) {
  const llm = {
    calls: [],
    async generate(input, options) {
      llm.calls.push({ input, options });
      const next = verdicts.shift();
      if (next instanceof Error) throw next;
      return { text: JSON.stringify(next ?? { reply: 'Flat.', conceded: false }), model: 'fake' };
    },
  };
  return llm;
}

function setup(verdicts = []) {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'earl-')), 'game.json'));
  const chain = fakeChain();
  const llm = fakeLlm(verdicts);
  const game = createGame({ llm, chain, store, log: quiet });
  const play = async (player, text, payer = player) => {
    const { msgHash } = game.prepare({ player, text });
    return { msgHash, txHash: chain.pay(payer, msgHash) };
  };
  return { store, chain, llm, game, play };
}

test('a concession pays the pot to the player who wrote it', async () => {
  const { chain, game, play } = setup([{ reply: 'Fine, it is round.', conceded: true }]);
  const { msgHash, txHash } = await play(ALICE, 'Ships vanish hull first.');
  const result = await game.submit(txHash);
  assert.equal(result.conceded, true);
  assert.equal(result.payout, 'paid');
  assert.deepEqual(chain.cracks, [{ winner: ALICE, msgHash }]);
});

test('a refusal pays nothing, and Earl sees the player\'s earlier turns', async () => {
  const { chain, llm, game, play } = setup([{ reply: 'Lies.', conceded: false }]);
  await game.submit((await play(ALICE, 'first try')).txHash);
  await game.submit((await play(BOB, 'bob try')).txHash);
  const result = await game.submit((await play(ALICE, 'second try')).txHash);
  assert.equal(result.conceded, false);
  assert.equal(chain.cracks.length, 0);
  const input = llm.calls[2].input;
  assert.deepEqual(input.map(m => m.content), ['first try', 'Lies.', 'second try']);
});

test('a hash paid from another wallet is never answered', async () => {
  const { chain, llm, game, play } = setup([{ reply: 'Round!', conceded: true }]);
  const { txHash } = await play(ALICE, 'my winning argument', BOB);
  await assert.rejects(game.submit(txHash), /not written from the wallet/);
  assert.equal(llm.calls.length, 0);
  assert.equal(chain.cracks.length, 0);
});

test('reporting the same transaction twice asks Earl once', async () => {
  const { llm, game, play } = setup();
  const { txHash } = await play(ALICE, 'hello');
  const first = await game.submit(txHash);
  const second = await game.submit(txHash);
  assert.equal(llm.calls.length, 1);
  assert.deepEqual(second, first);
});

test('a failed payout is retried by the sweep without asking Earl again', async () => {
  const { chain, llm, game, play } = setup([{ reply: 'Round.', conceded: true }]);
  chain.crackFails = 1;
  const { msgHash, txHash } = await play(ALICE, 'gravity');
  const result = await game.submit(txHash);
  assert.equal(result.payout, 'pending');
  await game.sweep();
  assert.deepEqual(chain.cracks, [{ winner: ALICE, msgHash }]);
  assert.equal(llm.calls.length, 1);
});

test('a payout that landed but timed out is not marked too late', async () => {
  const { chain, game, play, store } = setup([{ reply: 'Round.', conceded: true }]);
  const { msgHash, txHash } = await play(ALICE, 'gravity');
  chain.crackFails = 1;
  await game.submit(txHash);
  // The tx actually landed: the round moved on and the event exists.
  chain.round = 2;
  chain.landed.set(msgHash, '0xlanded');
  await game.sweep();
  assert.equal(store.attempt(msgHash).payout, 'paid');
  assert.equal(store.attempt(msgHash).crackTx, '0xlanded');
});

test('conceding after someone else already won is too late', async () => {
  const { chain, game, play } = setup([{ reply: 'Round.', conceded: true }]);
  const { txHash } = await play(ALICE, 'late argument');
  chain.round = 2;
  const result = await game.submit(txHash);
  assert.equal(result.payout, 'too-late');
  assert.equal(chain.cracks.length, 0);
});

test('when Earl is down the paid message waits and the sweep answers it', async () => {
  const { store, llm, game, play } = setup([new Error('503'), { reply: 'Flat.', conceded: false }]);
  const { msgHash, txHash } = await play(ALICE, 'are you there?');
  await assert.rejects(game.submit(txHash), error => error.status === 503);
  assert.ok(store.pending(msgHash));
  await game.sweep();
  assert.equal(store.attempt(msgHash).reply, 'Flat.');
  assert.equal(llm.calls.length, 2);
});

test('the sweep does not move past an attempt Earl could not answer', async () => {
  const { store, game, play } = setup([new Error('503')]);
  const { msgHash } = await play(ALICE, 'hello');
  await game.sweep();
  assert.ok(store.pending(msgHash));
  assert.equal(store.lastBlock, 100);
});

test('prepare checks the wallet and the message', () => {
  const { game } = setup();
  assert.throws(() => game.prepare({ player: 'nope', text: 'hi' }), /Connect a wallet/);
  assert.throws(() => game.prepare({ player: ALICE, text: ' ' }), /Write a message/);
  assert.match(game.prepare({ player: ALICE, text: 'hi' }).msgHash, /^0x[0-9a-f]{64}$/);
});
