/*
 * [Sprint 6 · M3] US-41 (FR-16a, NFR-9, NFR-10a, NFR-10b): the shared LLM client.
 *
 * One small client that every AI feature uses: Ask the Copilot (US-41, M3), grounded answers (US-42,
 * US-43, M4) and Catch Me Up (US-44, M5). It talks to the "LLM API Provider (Claude / OpenAI)" from the
 * FR/NFR document with Node's built-in fetch, so no new npm package is needed.
 *
 * Settings (server environment only, backend/.env; never the frontend):
 *   LLM_PROVIDER           anthropic (default) | openai
 *                          "openai" means any OpenAI-compatible Chat Completions API (set LLM_BASE_URL for
 *                          providers other than OpenAI itself).
 *   LLM_API_KEY            the provider's API key. Empty = AI turned off: every call fails fast with
 *                          AiUnavailableError('not_configured') and the rest of DevOrbit works as usual.
 *   LLM_MODEL              model ID. Default for anthropic: claude-haiku-5-5. Required for openai.
 *   LLM_BASE_URL           optional. Default https://api.anthropic.com or https://api.openai.com/v1.
 *   LLM_TIMEOUT_MS         optional, 1000-60000, default 15000. A slower answer counts as "unavailable".
 *   LLM_MAX_OUTPUT_TOKENS  optional, 50-4000, default 500 (short answers keep the reply near 10 seconds).
 *
 * Outage handling (NFR-9: "only the affected AI functionality may be unavailable"):
 *   - Every failure (no key, timeout, network error, HTTP 429/5xx/4xx, unreadable or empty reply) becomes
 *     an AiUnavailableError with a short `reason`. Routes turn it into 503 + "AI temporarily unavailable".
 *   - After FAILURES_BEFORE_PAUSE failures in a row the client pauses for PAUSE_MS: calls fail at once
 *     (reason "paused") instead of each one waiting for the timeout, so a provider outage cannot tie up
 *     the API. The first call after the pause is a trial: success resumes normal calls, failure pauses again.
 *   - A request never runs longer than LLM_TIMEOUT_MS (one abort timer covers the headers and the body).
 *
 * Secrets: the API key is sent only in the request header. It is never put in an error message, a log
 * line, a response body or `client.status()`. Log lines name the provider and reason only, never the
 * question, the prompt or the answer.
 *
 * Unit tests (no MongoDB, no network: fetch is injected): backend/test/llmClient.test.js
 */

export const PROVIDERS = ['anthropic', 'openai'];
export const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_BASE_URL = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};
export const DEFAULT_MODEL = { anthropic: 'claude-haiku-5-5', openai: '' };

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 500;
export const MIN_OUTPUT_TOKENS = 50;
export const MAX_OUTPUT_TOKENS = 4_000;

export const FAILURES_BEFORE_PAUSE = 3;
export const PAUSE_MS = 30_000;

export const UNAVAILABLE_REASONS = [
  'not_configured',
  'paused',
  'timeout',
  'network',
  'rate_limited',
  'provider_error',
  'rejected',
  'bad_response',
];

export class AiUnavailableError extends Error {
  constructor(reason, { status = null } = {}) {
    super('The AI service is temporarily unavailable.');
    this.name = 'AiUnavailableError';
    this.code = 'AI_UNAVAILABLE';
    this.reason = reason;
    this.providerStatus = status;
  }
}

export function isAiUnavailable(error) {
  return error?.code === 'AI_UNAVAILABLE';
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function intSetting(raw, fallback, min, max) {
  const value = text(raw);
  if (!/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return number >= min && number <= max ? number : fallback;
}

// https:// anywhere, http:// only for a provider running on this machine (e.g. a local test server).
function usableBaseUrl(raw) {
  try {
    const url = new URL(raw);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * llmConfig(env) -> { configured, provider, apiKey, model, baseUrl, timeoutMs, maxOutputTokens }
 * Pure: reads only the object it is given.
 */
export function llmConfig(env = process.env) {
  const provider = text(env.LLM_PROVIDER).toLowerCase() || 'anthropic';
  const known = PROVIDERS.includes(provider);
  const apiKey = text(env.LLM_API_KEY);
  const model = text(env.LLM_MODEL) || (known ? DEFAULT_MODEL[provider] : '');
  const baseUrl = usableBaseUrl(text(env.LLM_BASE_URL) || (known ? DEFAULT_BASE_URL[provider] : ''));
  return {
    configured: Boolean(known && apiKey && model && baseUrl),
    provider,
    apiKey,
    model,
    baseUrl,
    timeoutMs: intSetting(env.LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxOutputTokens: intSetting(env.LLM_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
  };
}

// What is missing, by name only (never values), for the startup warning in server.js.
export function missingLlmSettings(env = process.env) {
  const config = llmConfig(env);
  const missing = [];
  if (!PROVIDERS.includes(config.provider)) missing.push('LLM_PROVIDER (anthropic or openai)');
  if (!config.apiKey) missing.push('LLM_API_KEY');
  if (PROVIDERS.includes(config.provider) && !config.model) missing.push('LLM_MODEL');
  if (PROVIDERS.includes(config.provider) && !config.baseUrl) missing.push('LLM_BASE_URL (must be an https:// URL)');
  return missing;
}

function checkMessages(messages) {
  const ok =
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  if (!ok) throw new TypeError('complete() needs messages: [{ role: "user" | "assistant", content: "..." }, ...]');
}

// The HTTP request for each provider. Exported for the unit tests.
export function buildRequest(config, { system = '', messages, maxTokens }) {
  const max = maxTokens || config.maxOutputTokens;
  if (config.provider === 'anthropic') {
    const body = { model: config.model, max_tokens: max, messages };
    if (system) body.system = system;
    return {
      url: `${config.baseUrl}/v1/messages`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify(body),
      },
    };
  }
  return {
    url: `${config.baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        max_tokens: max,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      }),
    },
  };
}

// Reads { text, truncated, usage } out of a provider reply. Exported for the unit tests.
export function readReply(provider, data) {
  if (provider === 'anthropic') {
    const parts = Array.isArray(data?.content) ? data.content : [];
    return {
      text: parts
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
        .trim(),
      truncated: data?.stop_reason === 'max_tokens',
      usage: { inputTokens: data?.usage?.input_tokens ?? null, outputTokens: data?.usage?.output_tokens ?? null },
    };
  }
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const content = choice?.message?.content;
  return {
    text: typeof content === 'string' ? content.trim() : '',
    truncated: choice?.finish_reason === 'length',
    usage: { inputTokens: data?.usage?.prompt_tokens ?? null, outputTokens: data?.usage?.completion_tokens ?? null },
  };
}

function reasonForStatus(status) {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error'; // includes Anthropic's 529 "overloaded"
  return 'rejected'; // 400/401/403/404: wrong key, wrong model name, bad request
}

function isTimeout(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

/**
 * createLlmClient({ env, fetchImpl, now, logger }) -> { complete, status }
 *
 * complete({ system, messages, maxTokens }) resolves to
 *   { text, truncated, usage: { inputTokens, outputTokens }, provider, model, durationMs }
 * or rejects with AiUnavailableError (reason: one of UNAVAILABLE_REASONS).
 * A TypeError means the caller passed bad messages (a bug, not an outage).
 */
export function createLlmClient({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now, logger = console } = {}) {
  const config = llmConfig(env);
  let failuresInARow = 0;
  let pausedUntil = 0;

  function failure(reason, status = null) {
    failuresInARow += 1;
    logger.warn(`[llm] ${config.provider} request failed: ${reason}${status ? ` (HTTP ${status})` : ''}`);
    if (failuresInARow >= FAILURES_BEFORE_PAUSE) {
      pausedUntil = now() + PAUSE_MS;
      logger.warn(`[llm] ${failuresInARow} failures in a row: AI requests paused for ${PAUSE_MS / 1000} s`);
    }
    return new AiUnavailableError(reason, { status });
  }

  async function complete({ system = '', messages, maxTokens } = {}) {
    checkMessages(messages);
    if (!config.configured) throw new AiUnavailableError('not_configured');
    if (now() < pausedUntil) throw new AiUnavailableError('paused');

    const { url, init } = buildRequest(config, { system, messages, maxTokens });
    const started = now();
    // One deadline for the whole request: headers and body. Cleared as soon as the reply has been read.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const timeout = new Error(`LLM request took longer than ${config.timeoutMs} ms`);
      timeout.name = 'TimeoutError';
      controller.abort(timeout);
    }, config.timeoutMs);
    let data;
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        // Read and drop the error body so the connection can be reused. Its text is not logged:
        // providers sometimes echo parts of the request.
        await response.text().catch(() => '');
        throw failure(reasonForStatus(response.status), response.status);
      }
      try {
        data = await response.json();
      } catch (error) {
        throw failure(isTimeout(error) || controller.signal.aborted ? 'timeout' : 'bad_response');
      }
    } catch (error) {
      if (isAiUnavailable(error)) throw error;
      throw failure(isTimeout(error) || controller.signal.aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }

    const reply = readReply(config.provider, data);
    if (!reply.text) throw failure('bad_response');

    failuresInARow = 0;
    pausedUntil = 0;
    return {
      text: reply.text,
      truncated: reply.truncated,
      usage: reply.usage,
      provider: config.provider,
      model: typeof data?.model === 'string' && data.model ? data.model : config.model,
      durationMs: Math.max(0, now() - started),
    };
  }

  // Safe to show anywhere: no key.
  function status() {
    const paused = now() < pausedUntil;
    return {
      configured: config.configured,
      provider: config.provider,
      model: config.model,
      timeoutMs: config.timeoutMs,
      maxOutputTokens: config.maxOutputTokens,
      paused,
      available: config.configured && !paused,
    };
  }

  return { complete, status };
}

// One client for the whole server, created on first use (after dotenv has loaded backend/.env).
let sharedClient = null;

export function getLlmClient() {
  if (!sharedClient) sharedClient = createLlmClient();
  return sharedClient;
}

// Tests (and later M4/M5 tests) put a fake client in place; null goes back to the real one.
export function setLlmClient(client) {
  sharedClient = client || null;
}
