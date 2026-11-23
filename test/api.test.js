import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroqClient,
  ERROR_KINDS,
  errorMessageOf,
  GroqError,
  kindOf,
  maskKeys,
  parseDuration,
  parseRetryAfter,
  readLimits,
} from '../src/groq-api.js';
import { API_KEY, MODELS, startFakeGroq } from './helpers/fake-groq.js';

const CHAT = 'POST /openai/v1/chat/completions';

const client = (api, options = {}) => {
  const waits = [];
  const instance = createGroqClient({
    getApiKey: () => options.key ?? API_KEY,
    baseUrl: api.url,
    sleep: async (ms) => {
      waits.push(ms);
    },
    now: () => 1_000_000,
    ...options,
  });
  return { instance, waits };
};

test('sends the key as a Bearer token, returns the JSON body and keeps the rate limits per model', async (t) => {
  const api = await startFakeGroq();
  t.after(api.close);
  const { instance } = client(api);
  const body = await instance.chat({
    model: 'openai/gpt-oss-20b',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(body.choices[0].message.content, 'Bonjour !');
  const sent = api.requests[0];
  assert.equal(sent.authorization, `Bearer ${API_KEY}`);
  assert.equal(sent.body.model, 'openai/gpt-oss-20b');
  assert.deepEqual(instance.limits('openai/gpt-oss-20b'), {
    at: 1_000_000,
    requests: { limit: 1000, remaining: 987, resetAt: 1_000_000 + 1_123_200 },
    tokens: { limit: 8000, remaining: 6200 },
  });
  assert.equal(instance.limits('openai/gpt-oss-120b'), null);
  assert.deepEqual(await instance.models(), MODELS);
  assert.deepEqual(
    api.requests.map((request) => request.route),
    [CHAT, 'GET /openai/v1/models'],
  );
});

test('no key: fails before any request', async (t) => {
  const api = await startFakeGroq();
  t.after(api.close);
  const { instance } = client(api, { key: '' });
  await assert.rejects(
    instance.chat({}),
    (err) => err instanceof GroqError && err.kind === ERROR_KINDS.AUTH,
  );
  assert.equal(api.requests.length, 0);
});

test('HTTP failures become error kinds, the key never in the message', async (t) => {
  const api = await startFakeGroq();
  t.after(api.close);
  const { instance } = client(api, { key: 'gsk_wrongkey123' });
  await assert.rejects(
    instance.chat({}),
    (err) =>
      err.kind === ERROR_KINDS.AUTH &&
      /HTTP 401: Invalid API Key/.test(err.message) &&
      !err.message.includes('wrongkey'),
  );
  const good = client(api).instance;
  api.reply(CHAT, {
    status: 404,
    body: {
      error: {
        message: 'The model `nope` does not exist or you do not have access to it.',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    },
  });
  await assert.rejects(good.chat({}), (err) => err.kind === ERROR_KINDS.MODEL);
  api.reply(CHAT, {
    status: 413,
    body: {
      error: {
        message:
          'Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 9655, please reduce your message size and try again.',
        type: 'tokens',
        code: 'rate_limit_exceeded',
      },
    },
  });
  await assert.rejects(good.chat({}), (err) => err.kind === ERROR_KINDS.TOO_LARGE);
  assert.equal(api.requests.length, 3, 'a request too large is never retried');
  api.reply(CHAT, {
    status: 400,
    body: {
      error: {
        message: 'Invalid tool call generated',
        type: 'invalid_request_error',
        code: 'tool_use_failed',
        failed_generation: { reason: 'Tool call arguments are not valid JSON' },
      },
    },
  });
  await assert.rejects(
    good.chat({}),
    (err) =>
      err.kind === ERROR_KINDS.REQUEST &&
      err.code === 'tool_use_failed' &&
      /not valid JSON/.test(err.message),
  );
  api.reply(CHAT, { status: 200, body: 'not json' });
  // Not JSON: a server fault, retried like a 5xx (here without retry).
  await assert.rejects(good.chat({}, { retries: false }), (err) => err.kind === ERROR_KINDS.SERVER);
});

test('429, 498 and 5xx are retried with Retry-After or backoff, then give up', async (t) => {
  const api = await startFakeGroq();
  t.after(api.close);
  const { instance, waits } = client(api, { now: Date.now });
  api.reply(CHAT, {
    status: 429,
    body: { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } },
    headers: { 'Retry-After': '2' },
  });
  api.reply(CHAT, {
    status: 498,
    body: { error: { message: 'Flex tier capacity exceeded' } },
  });
  const body = await instance.chat({});
  assert.equal(body.choices[0].message.content, 'Bonjour !');
  assert.deepEqual(waits, [2000, 2000]);
  for (let i = 0; i < 3; i += 1) {
    api.reply(CHAT, { status: 503, body: { error: { message: 'busy' } } });
  }
  await assert.rejects(instance.chat({}), (err) => err.kind === ERROR_KINDS.SERVER);
  assert.equal(api.requests.length, 6);
  // The key check never retries.
  api.reply('GET /openai/v1/models', { status: 503, body: { error: { message: 'busy' } } });
  await assert.rejects(instance.models(), (err) => err.kind === ERROR_KINDS.SERVER);
  assert.equal(api.requests.length, 7);
});

test('a wait that would not fit in the deadline fails at once with the real reason', async (t) => {
  const api = await startFakeGroq();
  t.after(api.close);
  const { instance, waits } = client(api, { now: Date.now });
  api.reply(CHAT, {
    status: 429,
    body: {
      error: {
        message: 'Rate limit reached on requests per day (RPD): Limit 1000, Used 1000',
        code: 'rate_limit_exceeded',
      },
    },
    headers: { 'Retry-After': '3600' },
  });
  await assert.rejects(
    instance.chat({}, { timeoutMs: 18_000 }),
    (err) => err.kind === ERROR_KINDS.RATE_LIMIT && /requests per day/.test(err.message),
  );
  assert.deepEqual(waits, []);
});

test('an unreachable API and a timeout are named as such', async () => {
  const unreachable = createGroqClient({
    getApiKey: () => 'k',
    baseUrl: 'http://127.0.0.1:9/openai/v1',
    sleep: async () => {},
  });
  await assert.rejects(
    unreachable.chat({}, { retries: false }),
    (err) => err.kind === ERROR_KINDS.UNREACHABLE,
  );
  const slow = createGroqClient({
    getApiKey: () => 'k',
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  });
  // AbortSignal.timeout does not keep the process alive: this timer does.
  const hold = setTimeout(() => {}, 1000);
  await assert.rejects(
    slow.chat({}, { timeoutMs: 50, retries: false }),
    (err) => err.kind === ERROR_KINDS.TIMEOUT,
  );
  clearTimeout(hold);
});

test('kinds, error bodies, keys, durations and Retry-After are read safely', () => {
  assert.equal(kindOf(401), 'auth');
  assert.equal(kindOf(400, 'invalid_api_key'), 'auth');
  assert.equal(kindOf(403), 'model');
  assert.equal(kindOf(404), 'model');
  assert.equal(kindOf(400, 'model_decommissioned'), 'model');
  assert.equal(kindOf(408), 'timeout');
  assert.equal(kindOf(413, null, 'Request too large … tokens per minute (TPM)'), 'too_large');
  assert.equal(kindOf(413, null, 'Payload too large'), 'request');
  assert.equal(kindOf(429), 'rate_limit');
  assert.equal(kindOf(498), 'rate_limit');
  assert.equal(kindOf(429, null, 'Organization spending limit reached'), 'spend_limit');
  assert.equal(kindOf(502), 'server');
  assert.equal(kindOf(400, 'tool_use_failed'), 'request');
  assert.equal(maskKeys('key gsk_abc123XYZ refused'), 'key gsk_*** refused');
  assert.equal(
    errorMessageOf({ error: { message: 'Bearer abc.def is invalid' } }),
    'Bearer *** is invalid',
  );
  assert.equal(errorMessageOf('x'.repeat(500)).length, 300);
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4000), 6000);
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseDuration('2m59.56s'), 179_560);
  assert.equal(parseDuration('7.66s'), 7660);
  assert.equal(parseDuration('120ms'), 120);
  assert.equal(parseDuration('1h2m3s'), 3_723_000);
  assert.equal(parseDuration('soon'), null);
  assert.equal(readLimits(new Headers({}), 0), null);
  assert.deepEqual(readLimits(new Headers({ 'x-ratelimit-limit-tokens': '8000' }), 5).tokens, {
    limit: 8000,
    remaining: null,
  });
});
