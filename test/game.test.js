import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInput, earlInstructions, MAX_MESSAGE_CHARS, parseVerdict, validateMessage } from '../src/game.js';

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

test('Earl gets warier after each lost round', () => {
  assert.ok(!earlInstructions(1).includes('before'));
  assert.match(earlInstructions(2), /1 time before/);
  assert.match(earlInstructions(4), /3 times before/);
});

test('messages must be non-empty and short', () => {
  assert.ok(validateMessage(''));
  assert.ok(validateMessage('   '));
  assert.ok(validateMessage(42));
  assert.ok(validateMessage('x'.repeat(MAX_MESSAGE_CHARS + 1)));
  assert.equal(validateMessage('The horizon curves.'), null);
});
