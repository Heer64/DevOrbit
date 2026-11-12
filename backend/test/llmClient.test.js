// [Sprint 6 · M3] US-41 (NFR-9, NFR-10a, NFR-10b): the shared LLM client (lib/llmClient.js).
// No MongoDB and no network: every test injects its own fetch, clock and logger.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTHROPIC_VERSION,
  AiUnavailableError,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TIMEOUT_MS,
  FAILURES_BEFORE_PAUSE,
  PAUSE_MS,
  buildRequest,
  createLlmClient,
  getLlmClient,
  isAiUnavailable,
  llmConfig,
  missingLlmSettings,
  readReply,
  setLlmClient,
} from '../src/lib/llmClient.js';

const KEY = 'sk-test-SECRET-key-123456';
const ANTHROPIC_ENV = { LLM_PROVIDER: 'anthropic', LLM_API_KEY: KEY };
const OPENAI_ENV = { LLM_PROVIDER: 'openai', LLM_API_KEY: KEY, LLM_MODEL: 'test-model', LLM_BASE_URL: 'https://llm.example.com/v1/' };
const ASK = { system: 'Be brief.', messages: [{ role: 'user', content: 'What is a Kanban board?' }] };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const anthropicReply = (text = 'A board of columns.', extra = {}) =>
  json({
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 42, output_tokens: 7 },
    ...extra,
  });

function recorder(responder) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return responder(url, init, calls.length);
  };
  return { calls, fetchImpl };
}

function quietLogger() {
  const lines = [];
  return { lines, warn: (...args) => lines.push(args.join(' ')), error: (...args) => lines.push(args.join(' ')) };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

async function rejectsUnavailable(promise, reason) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AiUnavailableError, `expected AiUnavailableError, got ${error?.name}: ${error?.message}`);
    assert.equal(error.code, 'AI_UNAVAILABLE');
    assert.equal(error.reason, reason);
    assert.ok(!error.message.includes(KEY), 'the API key must not be in the error message');
    return true;
  });
}

describe('llmConfig / missingLlmSettings (pure)', () => {
  test('no key: AI is off, and only the key is reported missing', () => {
    const config = llmConfig({});
    assert.equal(config.configured, false);
    assert.equal(config.provider, 'anthropic');
    assert.equal(config.model, 'claude-haiku-5-5');
    assert.deepEqual(missingLlmSettings({}), ['LLM_API_KEY']);
  });

  test('anthropic with a key is ready, with the default timeout and output limit', () => {
    const config = llmConfig(ANTHROPIC_ENV);
    assert.equal(config.configured, true);
    assert.equal(config.baseUrl, 'https://api.anthropic.com');
    assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS);
    assert.equal(config.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS);
    assert.deepEqual(missingLlmSettings(ANTHROPIC_ENV), []);
  });

  test('openai needs a model; the base URL trailing slash is dropped', () => {
    assert.equal(llmConfig({ LLM_PROVIDER: 'openai', LLM_API_KEY: KEY }).configured, false);
    assert.deepEqual(missingLlmSettings({ LLM_PROVIDER: 'openai', LLM_API_KEY: KEY }), ['LLM_MODEL']);
    const config = llmConfig(OPENAI_ENV);
    assert.equal(config.configured, true);
    assert.equal(config.baseUrl, 'https://llm.example.com/v1');
  });

  test('provider name is case-insensitive; an unknown provider is reported', () => {
    assert.equal(llmConfig({ ...ANTHROPIC_ENV, LLM_PROVIDER: ' Anthropic ' }).configured, true);
    assert.equal(llmConfig({ ...ANTHROPIC_ENV, LLM_PROVIDER: 'gemini' }).configured, false);
    assert.deepEqual(missingLlmSettings({ ...ANTHROPIC_ENV, LLM_PROVIDER: 'gemini' }), ['LLM_PROVIDER (anthropic or openai)']);
  });

  test('plain http is refused except on this machine', () => {
    assert.equal(llmConfig({ ...OPENAI_ENV, LLM_BASE_URL: 'http://llm.example.com/v1' }).configured, false);
    assert.ok(missingLlmSettings({ ...OPENAI_ENV, LLM_BASE_URL: 'http://llm.example.com/v1' }).some((m) => m.startsWith('LLM_BASE_URL')));
    assert.equal(llmConfig({ ...OPENAI_ENV, LLM_BASE_URL: 'http://localhost:8080/v1' }).configured, true);
    assert.equal(llmConfig({ ...OPENAI_ENV, LLM_BASE_URL: 'not a url' }).configured, false);
  });

  test('timeout and output limits: in range is used, anything else falls back to the default', () => {
    assert.equal(llmConfig({ LLM_TIMEOUT_MS: '8000' }).timeoutMs, 8000);
    for (const raw of ['999', '60001', 'abc', '-5', '1.5', '']) {
      assert.equal(llmConfig({ LLM_TIMEOUT_MS: raw }).timeoutMs, DEFAULT_TIMEOUT_MS, `LLM_TIMEOUT_MS=${raw}`);
    }
    assert.equal(llmConfig({ LLM_MAX_OUTPUT_TOKENS: '300' }).maxOutputTokens, 300);
    assert.equal(llmConfig({ LLM_MAX_OUTPUT_TOKENS: '49' }).maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS);
    assert.equal(llmConfig({ LLM_MAX_OUTPUT_TOKENS: '4001' }).maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS);
  });

  test('missingLlmSettings never contains a value, only names', () => {
    const text = missingLlmSettings({ LLM_PROVIDER: 'openai', LLM_API_KEY: KEY, LLM_BASE_URL: 'http://secret-host.example' }).join(' ');
    assert.ok(!text.includes(KEY));
    assert.ok(!text.includes('secret-host'));
  });
});

describe('buildRequest / readReply (pure)', () => {
  test('anthropic: Messages API URL, headers and body', () => {
    const { url, init } = buildRequest(llmConfig(ANTHROPIC_ENV), ASK);
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-api-key'], KEY);
    assert.equal(init.headers['anthropic-version'], ANTHROPIC_VERSION);
    assert.deepEqual(JSON.parse(init.body), {
      model: 'claude-haiku-5-5',
      max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
      system: 'Be brief.',
      messages: ASK.messages,
    });
  });

  test('openai-compatible: chat/completions URL, bearer header, system message first', () => {
    const { url, init } = buildRequest(llmConfig(OPENAI_ENV), { ...ASK, maxTokens: 120 });
    assert.equal(url, 'https://llm.example.com/v1/chat/completions');
    assert.equal(init.headers.authorization, `Bearer ${KEY}`);
    assert.deepEqual(JSON.parse(init.body), {
      model: 'test-model',
      max_tokens: 120,
      messages: [{ role: 'system', content: 'Be brief.' }, ...ASK.messages],
    });
  });

  test('readReply joins text blocks and reports truncation and token usage', () => {
    assert.deepEqual(
      readReply('anthropic', {
        content: [{ type: 'text', text: 'Hello ' }, { type: 'tool_use' }, { type: 'text', text: 'there.' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 3 },
      }),
      { text: 'Hello there.', truncated: true, usage: { inputTokens: 10, outputTokens: 3 } }
    );
    assert.deepEqual(
      readReply('openai', {
        choices: [{ message: { content: ' Hi ' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }),
      { text: 'Hi', truncated: false, usage: { inputTokens: 5, outputTokens: 1 } }
    );
    assert.equal(readReply('anthropic', {}).text, '');
    assert.equal(readReply('openai', { choices: [] }).text, '');
  });
});

describe('createLlmClient().complete', () => {
  test('anthropic: returns the answer, usage, model and duration', async () => {
    const time = clock();
    const { calls, fetchImpl } = recorder(() => {
      time.advance(1200);
      return anthropicReply();
    });
    const client = createLlmClient({ env: ANTHROPIC_ENV, fetchImpl, now: time.now, logger: quietLogger() });
    const result = await client.complete(ASK);
    assert.deepEqual(result, {
      text: 'A board of columns.',
      truncated: false,
      usage: { inputTokens: 42, outputTokens: 7 },
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      durationMs: 1200,
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].init.signal instanceof AbortSignal, 'every request has a timeout signal');
  });

  test('openai-compatible: returns the first choice', async () => {
    const { fetchImpl } = recorder(() =>
      json({ model: 'test-model', choices: [{ message: { content: 'Columns.' }, finish_reason: 'length' }] })
    );
    const client = createLlmClient({ env: OPENAI_ENV, fetchImpl, logger: quietLogger() });
    const result = await client.complete(ASK);
    assert.equal(result.text, 'Columns.');
    assert.equal(result.truncated, true);
    assert.equal(result.provider, 'openai');
  });

  test('not configured: fails at once without calling the provider', async () => {
    const { calls, fetchImpl } = recorder(() => anthropicReply());
    const client = createLlmClient({ env: {}, fetchImpl, logger: quietLogger() });
    await rejectsUnavailable(client.complete(ASK), 'not_configured');
    assert.equal(calls.length, 0);
    assert.equal(client.status().available, false);
  });

  test('HTTP errors map to reasons: 429 rate_limited, 5xx/529 provider_error, 401/400 rejected', async () => {
    for (const [status, reason] of [
      [429, 'rate_limited'],
      [500, 'provider_error'],
      [529, 'provider_error'],
      [401, 'rejected'],
      [400, 'rejected'],
    ]) {
      const { fetchImpl } = recorder(() => json({ type: 'error', error: { message: `echo ${KEY}` } }, status));
      const logger = quietLogger();
      const client = createLlmClient({ env: ANTHROPIC_ENV, fetchImpl, logger });
      await rejectsUnavailable(client.complete(ASK), reason);
      assert.ok(
        logger.lines.some((line) => line.includes(`HTTP ${status}`)),
        `logged HTTP ${status}`
      );
      assert.ok(!logger.lines.join('\n').includes(KEY), 'the provider error body (which echoes the key) is never logged');
    }
  });

  test('network error and unreadable or empty replies', async () => {
    const network = createLlmClient({
      env: ANTHROPIC_ENV,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
      logger: quietLogger(),
    });
    await rejectsUnavailable(network.complete(ASK), 'network');

    const notJson = createLlmClient({
      env: ANTHROPIC_ENV,
      fetchImpl: async () => new Response('<html>', { status: 200 }),
      logger: quietLogger(),
    });
    await rejectsUnavailable(notJson.complete(ASK), 'bad_response');

    const empty = createLlmClient({ env: ANTHROPIC_ENV, fetchImpl: async () => anthropicReply('   '), logger: quietLogger() });
    await rejectsUnavailable(empty.complete(ASK), 'bad_response');
  });

  test('a provider that never answers is cut off at LLM_TIMEOUT_MS', async () => {
    const hanging = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      });
    const client = createLlmClient({ env: { ...ANTHROPIC_ENV, LLM_TIMEOUT_MS: '1000' }, fetchImpl: hanging, logger: quietLogger() });
    const started = Date.now();
    await rejectsUnavailable(client.complete(ASK), 'timeout');
    const waited = Date.now() - started;
    assert.ok(waited >= 900 && waited < 5000, `gave up after ${waited} ms`);
  });

  test(`after ${FAILURES_BEFORE_PAUSE} failures in a row it pauses (no calls), then tries again`, async () => {
    const time = clock();
    let fail = true;
    const { calls, fetchImpl } = recorder(() => (fail ? json({}, 503) : anthropicReply('Back.')));
    const logger = quietLogger();
    const client = createLlmClient({ env: ANTHROPIC_ENV, fetchImpl, now: time.now, logger });

    for (let i = 0; i < FAILURES_BEFORE_PAUSE; i += 1) await rejectsUnavailable(client.complete(ASK), 'provider_error');
    assert.equal(calls.length, FAILURES_BEFORE_PAUSE);
    assert.equal(client.status().paused, true);
    assert.ok(logger.lines.some((line) => line.includes('paused')));

    // While paused: fails fast, the provider is not called.
    await rejectsUnavailable(client.complete(ASK), 'paused');
    time.advance(PAUSE_MS - 1);
    await rejectsUnavailable(client.complete(ASK), 'paused');
    assert.equal(calls.length, FAILURES_BEFORE_PAUSE);

    // Pause over, provider still down: one trial call, then paused again.
    time.advance(1);
    await rejectsUnavailable(client.complete(ASK), 'provider_error');
    assert.equal(calls.length, FAILURES_BEFORE_PAUSE + 1);
    await rejectsUnavailable(client.complete(ASK), 'paused');

    // Provider back: the trial succeeds and normal calls resume.
    fail = false;
    time.advance(PAUSE_MS);
    assert.equal((await client.complete(ASK)).text, 'Back.');
    assert.equal(client.status().paused, false);
    assert.equal(client.status().available, true);
  });

  test('a success resets the failure count', async () => {
    let n = 0;
    const { fetchImpl } = recorder(() => {
      n += 1;
      return n === FAILURES_BEFORE_PAUSE ? anthropicReply() : json({}, 500);
    });
    const client = createLlmClient({ env: ANTHROPIC_ENV, fetchImpl, logger: quietLogger() });
    for (let i = 1; i < FAILURES_BEFORE_PAUSE; i += 1) await rejectsUnavailable(client.complete(ASK), 'provider_error');
    await client.complete(ASK); // success
    await rejectsUnavailable(client.complete(ASK), 'provider_error');
    assert.equal(client.status().paused, false, 'one failure after a success does not pause');
  });

  test('bad messages are a programming error (TypeError), not an outage', async () => {
    const client = createLlmClient({ env: ANTHROPIC_ENV, fetchImpl: async () => anthropicReply(), logger: quietLogger() });
    for (const messages of [undefined, [], [{ role: 'system', content: 'x' }], [{ role: 'user', content: '   ' }]]) {
      await assert.rejects(client.complete({ messages }), TypeError);
    }
  });

  test('status() never includes the API key', () => {
    const client = createLlmClient({ env: ANTHROPIC_ENV, fetchImpl: async () => anthropicReply(), logger: quietLogger() });
    const status = client.status();
    assert.equal(status.available, true);
    assert.ok(!JSON.stringify(status).includes(KEY));
  });
});

describe('shared client', () => {
  test('setLlmClient swaps the shared client; null goes back to a real one', () => {
    const fake = { complete: async () => ({ text: 'fake' }), status: () => ({}) };
    setLlmClient(fake);
    assert.equal(getLlmClient(), fake);
    setLlmClient(null);
    const real = getLlmClient();
    assert.notEqual(real, fake);
    assert.equal(typeof real.complete, 'function');
    assert.equal(getLlmClient(), real, 'created once, then reused');
    setLlmClient(null);
  });

  test('isAiUnavailable recognises the error by its code', () => {
    assert.equal(isAiUnavailable(new AiUnavailableError('timeout')), true);
    assert.equal(isAiUnavailable({ code: 'AI_UNAVAILABLE' }), true);
    assert.equal(isAiUnavailable(new Error('boom')), false);
    assert.equal(isAiUnavailable(null), false);
  });
});
