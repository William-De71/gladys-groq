import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { createGroqClient, ERROR_KINDS } from '../src/groq-api.js';
import {
  collectSources,
  createWebSearchHandler,
  formatSources,
  readAnswer,
  searchModel,
} from '../src/websearch.js';
import { API_KEY, completion, startFakeGroq, webSearchCompletion } from './helpers/fake-groq.js';

const ROUTE = 'POST /openai/v1/chat/completions';

const setup = async (t, raw = {}) => {
  const api = await startFakeGroq();
  t.after(api.close);
  const config = normalizeConfig({ api_key: API_KEY, ...raw });
  const client = createGroqClient({
    getApiKey: () => config.api_key,
    baseUrl: api.url,
    sleep: async () => {},
  });
  const seen = { success: [], failures: [] };
  const handler = createWebSearchHandler({
    client,
    getConfig: () => config,
    usage: { recordSuccess: (e) => seen.success.push(e), recordError: () => {} },
    onFailure: (err) => seen.failures.push(err.kind),
  });
  return { api, handler, seen };
};

test('asks GPT-OSS with the browser search tool and returns the declared outputs', async (t) => {
  const { api, handler, seen } = await setup(t, { model: 'openai/gpt-oss-20b' });
  api.reply(ROUTE, { status: 200, body: webSearchCompletion() });
  const outputs = await handler({ question: 'Grève SNCF demain ?', instructions: 'Une phrase.' });
  assert.deepEqual(Object.keys(outputs).sort(), ['answer', 'sources']);
  assert.equal(outputs.answer, 'La grève SNCF est reconduite demain, avec un TGV sur deux.');
  assert.equal(
    outputs.sources,
    'Le Monde — https://www.lemonde.fr/a\nFrance Info — https://www.francetvinfo.fr/b',
  );
  const { body } = api.requests[0];
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.deepEqual(body.tools, [{ type: 'browser_search' }]);
  assert.equal(body.tool_choice, 'required');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.messages[1].content, 'Grève SNCF demain ?');
  assert.match(body.messages[0].content, /plain text[\s\S]*\nUne phrase\.$/);
  assert.equal(seen.success[0].use, 'web');
});

test('a chat model without browser search hands the search to GPT-OSS 120B', async (t) => {
  assert.equal(searchModel('qwen/qwen3.8-27b'), 'openai/gpt-oss-120b');
  assert.equal(searchModel(null), 'openai/gpt-oss-120b');
  assert.equal(searchModel('openai/gpt-oss-20b'), 'openai/gpt-oss-20b');
  const { api, handler } = await setup(t, { model: 'qwen/qwen3.8-27b', service_tier: 'auto' });
  await handler({ question: 'x' });
  assert.equal(api.requests[0].body.model, 'openai/gpt-oss-120b');
  assert.equal(api.requests[0].body.service_tier, 'auto');
});

test('empty question, failures, empty answer', async (t) => {
  const { api, handler, seen } = await setup(t);
  await assert.rejects(handler({ question: '   ' }), /empty/);
  api.reply(ROUTE, {
    status: 413,
    body: {
      error: {
        message:
          'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 12000',
        code: 'rate_limit_exceeded',
      },
    },
  });
  await assert.rejects(handler({ question: 'x' }), (err) => err.kind === ERROR_KINDS.TOO_LARGE);
  api.reply(ROUTE, { status: 200, body: completion({ content: '' }) });
  await assert.rejects(handler({ question: 'x' }), /no text/);
  assert.deepEqual(seen.failures, ['too_large', 'server']);
});

test('answers without sources and long source lists are read', () => {
  assert.deepEqual(readAnswer(completion({ content: ' Oui. ' })), { answer: 'Oui.', sources: [] });
  assert.deepEqual(readAnswer(null), { answer: '', sources: [] });
  assert.deepEqual(
    collectSources([{ a: { b: [{ url: 'ftp://x' }, { url: 'https://y', title: ' Y ' }] } }]),
    [{ title: 'Y', url: 'https://y' }],
  );
  const many = Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, url: `https://e.x/${i}` }));
  assert.equal(formatSources(many).split('\n').length, 5);
  assert.equal(formatSources([{ title: 'Sans lien', url: '' }]), 'Sans lien');
});
