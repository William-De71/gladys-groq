import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_CHAT_PURPOSES, validateAiCompletion } from '@gladysassistant/integration-sdk';
import { buildBody, createChatHandler, useOf } from '../src/chat.js';
import { normalizeConfig } from '../src/config.js';
import { createCatalog } from '../src/catalog.js';
import { createGroqClient, ERROR_KINDS } from '../src/groq-api.js';
import { API_KEY, completion, startFakeGroq } from './helpers/fake-groq.js';

const CHAT = 'POST /openai/v1/chat/completions';
const TOOLS = [
  {
    type: 'function',
    function: { name: 'device_set_value', parameters: { type: 'object', properties: {} } },
  },
];
const IMAGE = {
  role: 'user',
  content: [
    { type: 'text', text: 'Que vois-tu ?' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
  ],
};

const setup = async (t, raw = {}) => {
  const api = await startFakeGroq();
  t.after(api.close);
  const config = normalizeConfig({ api_key: API_KEY, ...raw });
  const client = createGroqClient({
    getApiKey: () => config.api_key,
    baseUrl: api.url,
    sleep: async () => {},
  });
  const catalog = createCatalog({ fetchModels: () => client.models() });
  const recorded = { success: [], error: [], failures: [], successes: 0 };
  const usage = {
    recordSuccess: (entry) => recorded.success.push(entry),
    recordError: (entry) => recorded.error.push(entry),
  };
  const handler = createChatHandler({
    client,
    getConfig: () => config,
    catalog,
    usage,
    onFailure: (err, context) => recorded.failures.push({ kind: err.kind, ...context }),
    onSuccess: () => {
      recorded.successes += 1;
    },
  });
  const chats = () => api.requests.filter((request) => request.route === CHAT);
  return { api, handler, recorded, config, catalog, chats };
};

test('the router gets the fast model at its lowest reasoning; the chat the main model with tools', async (t) => {
  const { handler, recorded, chats } = await setup(t);
  await handler({
    messages: [
      { role: 'system', content: 'Classify' },
      { role: 'user', content: 'Allume' },
    ],
    purpose: AI_CHAT_PURPOSES.INTENT_CLASSIFICATION,
  });
  const router = chats()[0].body;
  assert.equal(router.model, 'openai/gpt-oss-20b');
  assert.equal(router.reasoning_effort, 'low', 'GPT-OSS cannot turn reasoning off');
  assert.equal(router.include_reasoning, false);
  assert.equal(router.tools, undefined);
  assert.equal(router.user, 'gladys');
  assert.equal(router.service_tier, undefined, 'on demand is the default of Groq');

  const answer = await handler({
    messages: [{ role: 'user', content: 'Allume le salon' }],
    tools: TOOLS,
    tool_choice: 'required',
    max_tokens: 2000,
    purpose: AI_CHAT_PURPOSES.CHAT,
    categories: ['devices'],
  });
  const chat = chats()[1].body;
  assert.equal(chat.model, 'openai/gpt-oss-120b');
  assert.equal(chat.reasoning_effort, 'low');
  assert.equal(chat.tool_choice, 'required');
  assert.equal(chat.max_completion_tokens, 4096, 'the configured budget when the caller asks less');
  assert.equal(chat.max_tokens, undefined, 'deprecated by Groq');
  assert.equal(chat.purpose, undefined);
  assert.equal(chat.categories, undefined);
  assert.deepEqual(validateAiCompletion(answer), []);
  assert.deepEqual(
    recorded.success.map((entry) => entry.use),
    ['router', 'chat'],
  );
  assert.equal(recorded.success[1].usage.prompt_tokens_details.cached_tokens, 1536);
  assert.equal(recorded.successes, 2);
});

test('the reasoning level follows what each model accepts', () => {
  const body = (raw, purpose = 'chat') =>
    buildBody({ messages: [], purpose }, normalizeConfig({ api_key: 'k', ...raw }));
  // Qwen can turn reasoning off; GPT-OSS gets its lowest level.
  assert.equal(
    body({ fast_model: 'qwen/qwen3.8-27b' }, AI_CHAT_PURPOSES.INTENT_CLASSIFICATION)
      .reasoning_effort,
    'none',
  );
  assert.equal(body({ reasoning: 'none' }).reasoning_effort, 'low');
  assert.equal(body({ reasoning: 'high' }).reasoning_effort, 'high');
  // An unknown model gets nothing for "none", the level as asked otherwise.
  const custom = { model: 'custom', custom_model: 'meta-llama/llama-5-scout' };
  assert.equal(body({ ...custom, reasoning: 'none' }).reasoning_effort, undefined);
  assert.equal(body({ ...custom, reasoning: 'none' }).include_reasoning, undefined);
  assert.equal(body({ ...custom, reasoning: 'medium' }).reasoning_effort, 'medium');
});

test('the output budget is bounded by the model, the tier sent when not the default', () => {
  const body = buildBody(
    { messages: [], max_tokens: 30000, purpose: 'chat' },
    normalizeConfig({ api_key: 'k', model: 'qwen/qwen3.8-27b', service_tier: 'flex' }),
  );
  assert.equal(body.max_completion_tokens, 16384);
  assert.equal(body.service_tier, 'flex');
});

test('the purposes are counted as router, digest or chat', () => {
  assert.equal(useOf(AI_CHAT_PURPOSES.INTENT_CLASSIFICATION), 'router');
  assert.equal(useOf(AI_CHAT_PURPOSES.WEEKLY_DIGEST), 'digest');
  assert.equal(useOf(AI_CHAT_PURPOSES.CHAT), 'chat');
  assert.equal(useOf(undefined), 'chat');
});

test('no tools: neither tools nor tool_choice is sent', () => {
  const body = buildBody(
    { messages: [], tools: [], tool_choice: 'auto' },
    normalizeConfig({ api_key: 'k' }),
  );
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
});

test('a model that refuses reasoning_effort is asked again without it, then never', async (t) => {
  const { api, handler, chats } = await setup(t, {
    model: 'custom',
    custom_model: 'meta-llama/llama-5-scout',
  });
  api.reply(CHAT, {
    status: 400,
    body: {
      error: {
        message: '`reasoning_effort` is not supported with this model',
        type: 'invalid_request_error',
      },
    },
  });
  const answer = await handler({
    messages: [{ role: 'user', content: 'Bonjour' }],
    purpose: 'chat',
  });
  assert.equal(answer.choices[0].message.content, 'Bonjour !');
  assert.equal(chats()[0].body.reasoning_effort, 'low');
  assert.equal(chats()[1].body.reasoning_effort, undefined);
  assert.equal(chats()[1].body.include_reasoning, undefined);
  await handler({ messages: [{ role: 'user', content: 'Encore' }], purpose: 'chat' });
  assert.equal(chats()[2].body.reasoning_effort, undefined);
});

test('an invalid tool call written by the model is asked again once', async (t) => {
  const { api, handler, chats } = await setup(t);
  const invalid = {
    status: 400,
    body: {
      error: {
        message: 'Failed to call a function. Please adjust your prompt.',
        type: 'invalid_request_error',
        code: 'tool_use_failed',
      },
    },
  };
  api.reply(CHAT, invalid);
  api.reply(CHAT, {
    status: 200,
    body: completion(
      {
        content: null,
        reasoning: 'thinking that never reaches the core',
        tool_calls: [
          {
            id: 'fc_1',
            type: 'function',
            function: { name: 'device_set_value', arguments: '{}' },
          },
        ],
      },
      { finish_reason: 'tool_calls' },
    ),
  });
  const answer = await handler({
    messages: [{ role: 'user', content: 'Allume' }],
    tools: TOOLS,
    purpose: 'chat',
  });
  assert.equal(chats().length, 2);
  assert.equal(answer.choices[0].finish_reason, 'tool_calls');
  assert.equal(answer.choices[0].message.reasoning, undefined);
  assert.deepEqual(validateAiCompletion(answer), []);
  // Twice in a row: the second refusal goes to the core.
  api.reply(CHAT, invalid);
  api.reply(CHAT, invalid);
  await assert.rejects(
    handler({ messages: [{ role: 'user', content: 'Allume' }], tools: TOOLS, purpose: 'chat' }),
    (err) => err.kind === ERROR_KINDS.REQUEST,
  );
  assert.equal(chats().length, 4);
});

test('failures are thrown (the core names them), counted and reported', async (t) => {
  const { api, handler, recorded, chats } = await setup(t);
  api.reply(CHAT, {
    status: 401,
    body: { error: { message: 'Invalid API Key', code: 'invalid_api_key' } },
  });
  await assert.rejects(
    handler({ messages: [], purpose: 'chat' }),
    (err) => err.kind === ERROR_KINDS.AUTH,
  );
  assert.deepEqual(recorded.failures, [
    { kind: 'auth', use: 'chat', model: 'openai/gpt-oss-120b' },
  ]);
  assert.equal(recorded.error[0].kind, 'auth');

  // GPT-OSS reads no image: refused before any call.
  await assert.rejects(handler({ messages: [IMAGE], purpose: 'chat' }), /cannot read images/);
  assert.equal(chats().length, 1);
});

test('images go to Qwen, which reads them', async (t) => {
  const { handler, chats } = await setup(t, { model: 'qwen/qwen3.8-27b' });
  await handler({ messages: [IMAGE], purpose: 'chat' });
  const sent = chats()[0].body.messages[0].content;
  assert.equal(sent[1].type, 'image_url');
});

test('an answer cut before any text fails clearly; a cut text is still returned', async (t) => {
  const { api, handler } = await setup(t);
  api.reply(CHAT, {
    status: 200,
    body: completion({ content: '' }, { finish_reason: 'length' }),
  });
  await assert.rejects(handler({ messages: [], purpose: 'chat' }), /cut at max_tokens/);
  api.reply(CHAT, {
    status: 200,
    body: completion({ content: 'Le début' }, { finish_reason: 'length' }),
  });
  const answer = await handler({ messages: [], purpose: 'chat' });
  assert.equal(answer.choices[0].message.content, 'Le début');
});

test('a custom model without id fails without calling Groq', async (t) => {
  const { api, handler } = await setup(t, { fast_model: 'custom' });
  await assert.rejects(
    handler({ messages: [], purpose: AI_CHAT_PURPOSES.INTENT_CLASSIFICATION }),
    (err) => err.kind === ERROR_KINDS.MODEL,
  );
  assert.equal(api.requests.length, 0);
});
