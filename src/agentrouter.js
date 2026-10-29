const PROFILES = {
  codex: {
    'User-Agent': 'codex_cli_rs/0.120.0',
    originator: 'codex_cli_rs',
  },
  'claude-code': {
    'User-Agent': 'claude-cli/2.1.289 (external, cli)',
    'x-app': 'cli',
  },
};

export class AgentRouterError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'AgentRouterError';
    this.status = status;
    this.code = code;
  }
}

function redact(value, key) {
  return String(value).split(key).join('[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

function errorMessage(payload, fallback) {
  const error = payload?.error ?? payload?.response?.error;
  return typeof error === 'string' ? error : error?.message ?? payload?.message ?? fallback;
}

// Decode complete SSE records, including records split across network chunks.
async function* readEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  function parse(record) {
    const data = record.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') return null;
    return JSON.parse(data);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const event = parse(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
        if (event) yield event;
      }
      if (done) break;
    }
    const event = parse(buffer);
    if (event) yield event;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function responseText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  return (response.output ?? []).flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('');
}

/** A server-side OpenAI Responses client with selectable CLI identity headers.
 * These headers imitate a client profile; this does not run either CLI.
 */
export class AgentRouterClient {
  #apiKey;
  #fetch;
  #headers;
  #url;
  #timeoutMs;

  constructor({
    apiKey = process.env.AGENTROUTER_API_KEY,
    model = process.env.AGENTROUTER_MODEL || 'gpt-6.1-sol',
    baseUrl = process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1',
    client = process.env.AGENTROUTER_CLIENT || 'codex',
    userAgent = process.env.AGENTROUTER_USER_AGENT,
    timeoutMs = 120_000,
    fetch: fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new AgentRouterError('Set AGENTROUTER_API_KEY in .env or the environment.');
    }
    if (!Object.hasOwn(PROFILES, client)) {
      throw new AgentRouterError('Client must be codex or claude-code.');
    }
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new AgentRouterError('Base URL must be HTTPS without credentials, query, or fragment.');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new AgentRouterError('timeoutMs must be a positive integer.');
    }
    this.#apiKey = apiKey.trim();
    this.#fetch = fetchImpl;
    this.#url = `${url.href.replace(/\/+$/, '')}/responses`;
    this.#timeoutMs = timeoutMs;
    this.#headers = {
      ...PROFILES[client],
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
      Authorization: `Bearer ${this.#apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
    };
    this.model = model;
  }

  async generate(input, {
    instructions = 'You are a helpful assistant.',
    maxOutputTokens = 1024,
    reasoningEffort = 'low',
    onText,
    signal,
  } = {}) {
    if (!(typeof input === 'string' && input.trim()) && !(Array.isArray(input) && input.length)) {
      throw new AgentRouterError('Provide a prompt or a non-empty Responses input array.');
    }
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
      throw new AgentRouterError('maxOutputTokens must be a positive integer.');
    }
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) {
      throw new AgentRouterError('Unsupported reasoning effort.');
    }
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
      : AbortSignal.timeout(this.#timeoutMs);
    try {
      const http = await this.#fetch(this.#url, {
        method: 'POST',
        headers: this.#headers,
        // Do not forward credentials to a redirect destination.
        redirect: 'error',
        signal: requestSignal,
        body: JSON.stringify({
          model: this.model,
          instructions,
          input: typeof input === 'string'
            ? [{ role: 'user', content: [{ type: 'input_text', text: input }] }]
            : input,
          reasoning: { effort: reasoningEffort },
          max_output_tokens: maxOutputTokens,
          stream: true,
          store: false,
        }),
      });
      if (!http.ok) {
        const raw = await http.text();
        let payload;
        try { payload = JSON.parse(raw); } catch { /* e.g. a gateway HTML error */ }
        const detail = payload
          ? errorMessage(payload, http.statusText)
          : /<html|<!doctype/i.test(raw) ? 'Gateway returned an HTML challenge or error.' : raw.slice(0, 1000);
        throw new AgentRouterError(`AgentRouter HTTP ${http.status}: ${detail}`, {
          status: http.status, code: payload?.error?.code,
        });
      }
      let response;
      let text = '';
      const isStream = http.headers.get('content-type')?.includes('text/event-stream');
      if (isStream) {
        if (!http.body) throw new AgentRouterError('AgentRouter returned an empty stream.');
        for await (const event of readEvents(http.body)) {
          if (event.type === 'response.output_text.delta') {
            text += event.delta;
            onText?.(event.delta);
          }
          if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) {
            throw new AgentRouterError(errorMessage(event,
              `Response ${event.type}: ${event.response?.incomplete_details?.reason ?? 'request failed'}`));
          }
          if (event.type === 'response.completed') {
            response = event.response;
            break;
          }
        }
        if (!response) throw new AgentRouterError('Stream ended before response.completed.');
      } else {
        response = await http.json();
      }
      if (response.error || response.status === 'failed' || response.status === 'incomplete') {
        throw new AgentRouterError(errorMessage(response,
          `Response ${response.status}: ${response.incomplete_details?.reason ?? 'request failed'}`));
      }
      const fullText = responseText(response);
      if (!text && fullText) onText?.(fullText);
      return { text: fullText || text, model: response.model ?? this.model,
        id: response.id, usage: response.usage, response };
    } catch (error) {
      const message = error.name === 'TimeoutError'
        ? `AgentRouter request timed out after ${this.#timeoutMs}ms.`
        : error.message;
      throw new AgentRouterError(redact(message, this.#apiKey), {
        status: error.status, code: error.code,
      });
    }
  }
}
