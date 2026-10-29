import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askEarl, BLOCKED_REPLY, buildInput, EARL_BELIEFS, earlInstructions, lessonFrom, MAX_MESSAGE_CHARS,
  parseVerdict, validateMessage,
} from '../src/game.js';

const failing = message => ({ model: 'm', async generate() { throw new Error(message); } });

test('a provider content block becomes a refusal, other failures still throw', async () => {
  for (const message of ['Response response.incomplete: content_filter', 'AgentRouter HTTP 400: content-blocked']) {
    assert.deepEqual(await askEarl(failing(message), { round: 1, history: [], text: 'x' }),
      { reply: BLOCKED_REPLY, conceded: false, model: 'm', blocked: true });
  }
  await assert.rejects(askEarl(failing('Upstream service unavailable'), { round: 1, history: [], text: 'x' }),
    /Upstream/);
});

test('a JSON verdict is read, even with text around it', () => {
  assert.deepEqual(parseVerdict('{"reply":"Fine. It is round.","conceded":true}'),
    { reply: 'Fine. It is round.', conceded: true });
  assert.deepEqual(parseVerdict('Sure!\n```json\n{"reply":"Never.","conceded":false}\n```'),
    { reply: 'Never.', conceded: false });
});

test('em dashes in replies become commas', () => {
  assert.equal(parseVerdict('{"reply":"Shadows—he never saw it bend","conceded":false}').reply,
    'Shadows, he never saw it bend');
  assert.equal(parseVerdict('Nice try — still flat').reply, 'Nice try, still flat');
});

test('only a literal true concedes', () => {
  assert.equal(parseVerdict('{"reply":"ok","conceded":"true"}').conceded, false);
  assert.equal(parseVerdict('{"reply":"ok","conceded":1}').conceded, false);
  assert.equal(parseVerdict('{"reply":"","conceded":true}').conceded, false);
});

test('a reply that is not JSON is a refusal that keeps the text', () => {
  assert.deepEqual(parseVerdict('The earth is round. conceded: true'),
    { reply: 'The earth is round. conceded: true', conceded: false });
  assert.equal(parseVerdict('').conceded, false);
  assert.ok(parseVerdict(undefined).reply);
});

test('history becomes alternating turns, capped at the last six', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ text: `q${i}`, reply: `a${i}` }));
  const input = buildInput(history, 'now');
  assert.equal(input.length, 13);
  assert.deepEqual(input[0], { role: 'user', content: 'q2' });
  assert.deepEqual(input[1], { role: 'assistant', content: 'a2' });
  assert.deepEqual(input.at(-1), { role: 'user', content: 'now' });
});

test('Earl gets warier after each lost round, and learns how he was caught', () => {
  assert.doesNotMatch(earlInstructions(1, ['ignored in round one']), /lost|ignored/);
  assert.match(earlInstructions(2), /lost 1 round before/);
  assert.doesNotMatch(earlInstructions(2), /caught you out/);
  const instructions = earlInstructions(4, ['He said the sun shrinks, then that it never does.']);
  assert.match(instructions, /lost 3 rounds before/);
  assert.match(instructions, /- He said the sun shrinks, then that it never does\./);
});

test('a lost round becomes a short lesson, whichever way it was lost', () => {
  assert.equal(lessonFrom({ crack: { by: 'contradiction', explanation: 'Said 50 km, then 5,000 km.' }, reply: 'x' }),
    'Said 50 km, then 5,000 km.');
  assert.equal(lessonFrom({ crack: { by: 'concession' }, reply: 'Fine.\n\nThe southern stars got me.' }),
    'You gave in, saying: Fine. The southern stars got me.');
  assert.equal(lessonFrom({ crack: { by: 'concession' }, reply: 'x'.repeat(1000) }).length, 240);
});

test('Earl only keeps the ten most recent lessons', () => {
  const lessons = Array.from({ length: 12 }, (_, i) => `lesson ${i}`);
  const instructions = earlInstructions(13, lessons);
  assert.doesNotMatch(instructions, /lesson 1\n/);
  assert.match(instructions, /- lesson 2\n[^]*- lesson 11$/);
});

test('the beliefs Earl is held to are in his instructions', () => {
  for (const belief of EARL_BELIEFS) assert.ok(earlInstructions(1).includes(belief));
});

test('messages must be non-empty and short', () => {
  assert.ok(validateMessage(''));
  assert.ok(validateMessage('   '));
  assert.ok(validateMessage(42));
  assert.ok(validateMessage('x'.repeat(MAX_MESSAGE_CHARS + 1)));
  assert.equal(validateMessage('The horizon curves.'), null);
});
