import test from 'node:test';
import assert from 'node:assert/strict';
import { GroqClient } from '../src/groq.js';
import { askEarl, isBlocked } from '../src/game.js';

const apiKey = 'gsk-test-private-key';
const answer = text => ({ model: 'groq-test', usage: { total_tokens: 8 },
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] });

function client(fetch) {
  return new GroqClient({ apiKey, fetch, model: 'groq-test' });
}

test('sends the instructions and history, and returns the text', async () => {
  let sent;
  const groq = client(async (url, request) => {
    sent = { url, request };
    return Response.json(answer('Hello 🌍'));
  });
  const history = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Howdy' }, { role: 'user', content: 'Well?' }];
  const result = await groq.generate(history, { instructions: 'Be Earl', maxOutputTokens: 50, reasoningEffort: 'medium' });
  assert.equal(result.text, 'Hello 🌍');
  assert.equal(result.model, 'groq-test');
  assert.deepEqual(result.usage, { total_tokens: 8 });
  assert.equal(sent.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(sent.request.headers.Authorization, `Bearer ${apiKey}`);
  assert.equal(sent.request.redirect, 'error');
  assert.ok(!sent.url.includes(apiKey));
  const body = JSON.parse(sent.request.body);
  assert.equal(body.model, 'groq-test');
  assert.deepEqual(body.messages, [{ role: 'system', content: 'Be Earl' }, ...history]);
  assert.equal(body.max_completion_tokens, 50);
  assert.equal(body.reasoning_effort, 'medium');
});

test('a plain string becomes one user message', async () => {
  let body;
  const groq = client(async (url, request) => {
    body = JSON.parse(request.body);
    return Response.json(answer('OK'));
  });
  await groq.generate('Reply with OK');
  assert.deepEqual(body.messages.at(-1), { role: 'user', content: 'Reply with OK' });
});

test('reports errors and keeps the key out of them', async () => {
  const leaky = client(async () => Response.json({ error: { message: `bad key ${apiKey}` } }, { status: 401 }));
  await assert.rejects(leaky.generate('Hi'), error => {
    assert.equal(error.status, 401);
    assert.equal(error.message, 'Groq HTTP 401: bad key [REDACTED]');
    return true;
  });
  const html = client(async () => new Response('<html>gateway</html>', { status: 503 }));
  await assert.rejects(html.generate('Hi'), /Groq HTTP 503: <html>/);
});

test('a refused message counts as Earl refusing, not as an outage', async () => {
  const filtered = client(async () => Response.json({ choices: [{ finish_reason: 'content_filter', message: {} }] }));
  await assert.rejects(filtered.generate('Hi'), error => isBlocked(error));
  const empty = client(async () => Response.json({ choices: [] }));
  const earl = await askEarl(empty, { round: 1, history: [], text: 'Hi' });
  assert.equal(earl.blocked, true);
  assert.equal(earl.conceded, false);
});

test('an empty answer is an error to retry, not a blank reply', async () => {
  const groq = client(async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '' } }] }));
  await assert.rejects(groq.generate('Hi'), /no text \(length\)/);
});

test('needs a key and something to send', async () => {
  assert.throws(() => new GroqClient({ apiKey: ' ' }), /GROQ_API_KEY/);
  await assert.rejects(client(async () => Response.json(answer('x'))).generate(' '), /Provide a prompt/);
});
