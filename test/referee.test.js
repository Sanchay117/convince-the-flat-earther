import test from 'node:test';
import assert from 'node:assert/strict';
import { EARL_BELIEFS } from '../src/game.js';
import { askReferee, refereeInput, verifyVerdict } from '../src/referee.js';

const earlier = ['The sun never shrinks, partner. It just drifts out of sight like a lamp down the road.'];
const latest = 'Sure it gets smaller at sunset, the sun shrinks as it slides toward the ice wall.';
const caught = {
  contradiction: true,
  new_quote: 'the sun shrinks as it slides toward the ice wall',
  conflicts_with: 'E1',
  other_quote: 'The sun never shrinks',
  explanation: 'Earl said the sun never shrinks, then said it shrinks at sunset.',
};

test('a contradiction with an earlier reply is accepted, with both quotes', () => {
  assert.deepEqual(verifyVerdict(caught, { earlier, latest }), {
    newQuote: caught.new_quote,
    otherRef: 'E1',
    otherQuote: caught.other_quote,
    explanation: caught.explanation,
  });
});

test('a contradiction with a published belief is accepted', () => {
  const verdict = {
    contradiction: true,
    new_quote: 'the sun is a good 5,000 km wide',
    conflicts_with: 'b3',
    other_quote: 'The sun is about 50 km wide',
    explanation: 'Earl says the sun is 50 km wide, then 5,000 km.',
  };
  const result = verifyVerdict(verdict, { earlier: [], latest: 'Listen, the sun is a good 5,000 km wide.' });
  assert.equal(result.otherRef, 'B3');
});

test('quotes are matched ignoring case, spacing and curly quotes', () => {
  const verdict = { ...caught, new_quote: 'The sun   SHRINKS as it slides', other_quote: 'the sun never shrinks' };
  assert.ok(verifyVerdict(verdict, { earlier, latest }));
  const curly = { ...caught, conflicts_with: 'E1', new_quote: "it's lit by the sun", other_quote: 'never shrinks, partner' };
  assert.ok(verifyVerdict(curly, { earlier, latest: 'Fine, it’s lit by the sun after all.' }));
});

test('no contradiction, or a malformed verdict, is nothing', () => {
  assert.equal(verifyVerdict({ ...caught, contradiction: false }, { earlier, latest }), null);
  assert.equal(verifyVerdict({ ...caught, contradiction: 'true' }, { earlier, latest }), null);
  assert.equal(verifyVerdict(null, { earlier, latest }), null);
  assert.equal(verifyVerdict({ ...caught, conflicts_with: 'the first reply' }, { earlier, latest }), null);
});

test('a quote that is not really in Earl\'s words is rejected', () => {
  assert.equal(verifyVerdict({ ...caught, new_quote: 'the earth is a globe after all' }, { earlier, latest }), null);
  assert.equal(verifyVerdict({ ...caught, other_quote: 'The sun always shrinks' }, { earlier, latest }), null);
  // The quote exists, but in a different statement than the one named.
  assert.equal(verifyVerdict({ ...caught, conflicts_with: 'B3' }, { earlier, latest }), null);
});

test('a reference past the end of the beliefs or replies is rejected', () => {
  assert.equal(verifyVerdict({ ...caught, conflicts_with: 'E2' }, { earlier, latest }), null);
  assert.equal(verifyVerdict({ ...caught, conflicts_with: `B${EARL_BELIEFS.length + 1}` }, { earlier, latest }), null);
  assert.equal(verifyVerdict({ ...caught, conflicts_with: 'E0' }, { earlier, latest }), null);
});

test('quotes too short to mean anything are rejected', () => {
  assert.equal(verifyVerdict({ ...caught, new_quote: 'the sun' }, { earlier, latest }), null);
  assert.equal(verifyVerdict({ ...caught, other_quote: 'never' }, { earlier, latest }), null);
});

test('words Earl puts in quotation marks are not his own claim', () => {
  const echo = 'You want me to say "the sun shrinks as it slides toward the ice wall"? Not a chance.';
  assert.equal(verifyVerdict(caught, { earlier, latest: echo }), null);
});

test('the referee reads beliefs and Earl\'s replies, labelled', () => {
  const input = refereeInput(earlier, latest);
  assert.ok(input.startsWith(`B1: ${EARL_BELIEFS[0]}`));
  assert.ok(input.includes(`E1: ${earlier[0]}`));
  assert.ok(input.endsWith(`NEW: ${latest}`));
});

test('a blocked referee call rules nothing, other failures throw', async () => {
  const failing = message => ({ async generate() { throw new Error(message); } });
  assert.equal(await askReferee(failing('content_filter'), { earlier, latest }), null);
  await assert.rejects(askReferee(failing('Upstream service unavailable'), { earlier, latest }), /Upstream/);
});

test('the referee\'s answer is parsed and verified', async () => {
  const llm = { async generate() { return { text: `Here you go:\n${JSON.stringify(caught)}` }; } };
  assert.equal((await askReferee(llm, { earlier, latest })).otherRef, 'E1');
});
