import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRouterClient } from '../src/agentrouter.js';

const apiKey = 'sk-test-private-key';
const completed = { id: 'resp_test', model: 'gpt-6.1-sol', status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello 🌍' }] }],
  usage: { input_tokens: 5, output_tokens: 3 } };
const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;

function streamResponse(text) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      // Split UTF-8, JSON, CRLF, and SSE records across chunks.
      controller.enqueue(bytes.slice(offset, offset += 3));
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

function client(fetch, options = {}) {
  return new AgentRouterClient({ apiKey, fetch, baseUrl: 'https://agentrouter.org/v1/',
    client: 'codex', userAgent: '', ...options });
}

test('streams split UTF-8 events and returns usage from the completion', async () => {
  let sent;
  const deltas = [];
  const router = client(async (url, request) => {
    sent = { url, request };
    return streamResponse(': keepalive\r\n\r\n' + event({ type: 'response.output_text.delta', delta: 'Hello ' })
      + event({ type: 'response.output_text.delta', delta: '🌍' })
      + event({ type: 'response.completed', response: completed }));
  });
  const result = await router.generate('Hi', { onText: delta => deltas.push(delta) });
  assert.equal(result.text, 'Hello 🌍');
  assert.deepEqual(deltas, ['Hello ', '🌍']);
  assert.deepEqual(result.usage, completed.usage);
  assert.equal(sent.url, 'https://agentrouter.org/v1/responses');
  assert.equal(sent.request.headers.Authorization, `Bearer ${apiKey}`);
  assert.equal(sent.request.headers.originator, 'codex_cli_rs');
  assert.equal(sent.request.redirect, 'error');
  const body = JSON.parse(sent.request.body);
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.store, false);
  assert.equal(body.input[0].content[0].text, 'Hi');
  assert.ok(!sent.url.includes(apiKey));
});

test('Claude Code profile uses the GPT Responses protocol and its own headers', async () => {
  const router = client(async (url, request) => {
    assert.equal(url, 'https://agentrouter.org/v1/responses');
    assert.equal(request.headers['User-Agent'], 'claude-cli/2.1.289 (external, cli)');
    assert.equal(request.headers['x-app'], 'cli');
    assert.equal(request.headers.originator, undefined);
    return Response.json(completed);
  }, { client: 'claude-code' });
  assert.equal((await router.generate('Hi')).text, 'Hello 🌍');
});

test('supports a User-Agent override and conversation input', async () => {
  const input = [{ role: 'user', content: 'Hi' }];
  const router = client(async (_url, request) => {
    assert.equal(request.headers['User-Agent'], 'custom-client/1');
    assert.deepEqual(JSON.parse(request.body).input, input);
    return Response.json(completed);
  }, { userAgent: 'custom-client/1' });
  await router.generate(input);
});

test('redacts a gateway-echoed credential and preserves HTTP status', async () => {
  let calls = 0;
  const router = client(async () => {
    calls++;
    return Response.json({ error: { message: `Rejected ${apiKey}`, code: 'forbidden' } }, { status: 403 });
  });
  await assert.rejects(router.generate('Hi'), error => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'forbidden');
    assert.ok(error.message.includes('[REDACTED]'));
    assert.ok(!JSON.stringify(error).includes(apiKey));
    assert.ok(!error.stack.includes(apiKey));
    return true;
  });
  assert.equal(calls, 1);
});

test('an HTML gateway challenge produces a readable error', async () => {
  const router = client(async () => new Response('<!doctype html><html>Challenge</html>', { status: 403 }));
  await assert.rejects(router.generate('Hi'), /HTML challenge or error/);
});

test('a truncated stream is a failure even after partial output', async () => {
  const router = client(async () => streamResponse(event({ type: 'response.output_text.delta', delta: 'Partial' })));
  await assert.rejects(router.generate('Hi'), /before response.completed/);
});

test('an incomplete response reports its token limit', async () => {
  const router = client(async () => streamResponse(event({ type: 'response.incomplete',
    response: { incomplete_details: { reason: 'max_output_tokens' } } })));
  await assert.rejects(router.generate('Hi'), /max_output_tokens/);
});

test('in-stream provider errors are not returned as successful output', async () => {
  const router = client(async () => streamResponse(event({ type: 'response.failed',
    response: { error: { message: 'No available channel' } } })));
  await assert.rejects(router.generate('Hi'), /No available channel/);
});

test('a caller can cancel an in-flight request', async () => {
  const controller = new AbortController();
  controller.abort();
  const router = client(async (_url, request) => {
    request.signal.throwIfAborted();
  });
  await assert.rejects(router.generate('Hi', { signal: controller.signal }), /abort/i);
});

test('invalid configuration and empty prompts fail before any request', async () => {
  assert.throws(() => new AgentRouterClient({ apiKey: '' }), /AGENTROUTER_API_KEY/);
  assert.throws(() => client(() => {}, { baseUrl: 'http://example.com' }), /HTTPS/);
  assert.throws(() => client(() => {}, { baseUrl: 'https://user:secret@example.com' }), /credentials/);
  assert.throws(() => client(() => {}, { client: 'unknown' }), /codex or claude-code/);
  const router = client(() => assert.fail('No request expected'));
  await assert.rejects(router.generate('  '), /prompt/);
  await assert.rejects(router.generate('Hi', { maxOutputTokens: 0 }), /positive integer/);
});
