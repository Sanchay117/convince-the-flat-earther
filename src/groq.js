const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
  }
}

/** Groq's OpenAI-compatible endpoint, with the same generate() as AgentRouterClient. */
export class GroqClient {
  #apiKey;
  #fetch;
  #timeoutMs;

  constructor({
    apiKey = process.env.GROQ_API_KEY,
    model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    timeoutMs = 120_000,
    fetch: fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new GroqError('Set GROQ_API_KEY in .env or the environment.');
    }
    this.#apiKey = apiKey.trim();
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.model = model;
  }

  async generate(input, {
    instructions = 'You are a helpful assistant.',
    maxOutputTokens = 1024,
    reasoningEffort = 'low',
    signal,
  } = {}) {
    if (!(typeof input === 'string' && input.trim()) && !(Array.isArray(input) && input.length)) {
      throw new GroqError('Provide a prompt or a non-empty message array.');
    }
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
      : AbortSignal.timeout(this.#timeoutMs);
    try {
      const http = await this.#fetch(CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
        // Do not forward credentials to a redirect destination.
        redirect: 'error',
        signal: requestSignal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: instructions },
            ...(typeof input === 'string' ? [{ role: 'user', content: input }] : input),
          ],
          max_completion_tokens: maxOutputTokens,
          reasoning_effort: reasoningEffort,
        }),
      });
      const raw = await http.text();
      let payload;
      try { payload = JSON.parse(raw); } catch { /* e.g. a gateway HTML error */ }
      if (!http.ok) {
        throw new GroqError(`Groq HTTP ${http.status}: ${payload?.error?.message ?? raw.slice(0, 500)}`, { status: http.status });
      }
      const choice = payload?.choices?.[0];
      // game.js treats this wording as Earl refusing, not as an outage to wait out.
      if (!choice || choice.finish_reason === 'content_filter') {
        throw new GroqError('content_filter: Groq refused this message.');
      }
      const text = choice.message?.content ?? '';
      if (!text.trim()) throw new GroqError(`Groq returned no text (${choice.finish_reason}).`);
      return { text, model: payload.model ?? this.model, usage: payload.usage };
    } catch (error) {
      const message = error.name === 'TimeoutError'
        ? `Groq request timed out after ${this.#timeoutMs}ms.`
        : error.message;
      throw new GroqError(message.split(this.#apiKey).join('[REDACTED]'), { status: error.status });
    }
  }
}
