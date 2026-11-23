// -----------------------------------------------------------------------------
// A fake Groq API on 127.0.0.1, for the tests: real HTTP, no network.
//
// Every request is recorded (`requests`); the answer of each route comes from
// a queue of handlers (`reply(route, handler)`), or a default one. A handler
// returns `{ status, body, headers }`. The fixtures follow the API reference
// (console.groq.com/docs, read on 2026-11-23); the 401 body was captured from
// the real API with a made-up key. The completions are not captured.
//
// `node --test` also runs this file: nothing starts on import.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';

export const API_KEY = 'gsk_test0123456789abcdefABCDEF';

/** The rate limit headers of a free plan answer (docs: rate-limits). */
export const LIMIT_HEADERS = {
  'x-ratelimit-limit-requests': '1000',
  'x-ratelimit-remaining-requests': '987',
  'x-ratelimit-reset-requests': '18m43.2s',
  'x-ratelimit-limit-tokens': '8000',
  'x-ratelimit-remaining-tokens': '6200',
  'x-ratelimit-reset-tokens': '13.5s',
};

/**
 * @description A chat completion as Groq returns it.
 * @param {object} [message] - The assistant message.
 * @param {object} [extra] - Other fields (finish_reason, usage, model).
 * @returns {object} The body.
 */
export function completion(message = { role: 'assistant', content: 'Bonjour !' }, extra = {}) {
  return {
    id: 'chatcmpl-1a2b3c4d',
    object: 'chat.completion',
    created: 1795000000,
    model: extra.model ?? 'openai/gpt-oss-120b',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', ...message },
        logprobs: null,
        finish_reason: extra.finish_reason ?? 'stop',
      },
    ],
    usage: extra.usage ?? {
      queue_time: 0.02,
      prompt_tokens: 1800,
      prompt_time: 0.01,
      completion_tokens: 60,
      completion_time: 0.12,
      total_tokens: 1860,
      total_time: 0.13,
      prompt_tokens_details: { cached_tokens: 1536 },
    },
    system_fingerprint: 'fp_0a1b2c3d4e',
    service_tier: 'on_demand',
    x_groq: { id: 'req_01kexample' },
  };
}

/**
 * @description A completion of the browser search tool.
 * @returns {object} The body.
 */
export function webSearchCompletion() {
  return completion(
    {
      content: 'La grève SNCF est reconduite demain 【1†L4-L9】, avec un TGV sur deux 【2†L1-L3】.',
      executed_tools: [
        {
          index: 0,
          type: 'browser_search',
          arguments: '{"query":"grève SNCF demain"}',
          search_results: {
            results: [
              { title: 'Le Monde', url: 'https://www.lemonde.fr/a', score: 0.9 },
              { title: 'Le Monde', url: 'https://www.lemonde.fr/a', score: 0.8 },
              { title: 'France Info', url: 'https://www.francetvinfo.fr/b', score: 0.7 },
            ],
          },
        },
      ],
    },
    {
      usage: { prompt_tokens: 5200, completion_tokens: 90, total_tokens: 5290 },
    },
  );
}

/** GET /models, in the shape of the API reference. */
export const MODELS = [
  {
    id: 'openai/gpt-oss-120b',
    object: 'model',
    owned_by: 'OpenAI',
    active: true,
    context_window: 131072,
    max_completion_tokens: 65536,
  },
  {
    id: 'openai/gpt-oss-20b',
    object: 'model',
    owned_by: 'OpenAI',
    active: true,
    context_window: 131072,
    max_completion_tokens: 65536,
  },
  {
    id: 'qwen/qwen3.8-27b',
    object: 'model',
    owned_by: 'Alibaba Cloud',
    active: true,
    context_window: 131072,
    max_completion_tokens: 16384,
  },
  {
    id: 'whisper-large-v3-turbo',
    object: 'model',
    owned_by: 'OpenAI',
    active: true,
    context_window: 448,
    max_completion_tokens: 448,
  },
];

/**
 * @description Start the fake API.
 * @returns {Promise<object>} `{ url, requests, reply, close }`.
 */
export async function startFakeGroq() {
  const requests = [];
  const queues = new Map();
  const defaults = {
    'POST /openai/v1/chat/completions': () => ({
      status: 200,
      body: completion(),
      headers: LIMIT_HEADERS,
    }),
    'GET /openai/v1/models': () => ({ status: 200, body: { object: 'list', data: MODELS } }),
  };

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const path = decodeURIComponent(req.url);
      const route = `${req.method} ${path.split('?')[0]}`;
      const request = {
        route,
        path,
        headers: req.headers,
        authorization: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      };
      requests.push(request);
      let answer;
      if (request.authorization !== `Bearer ${API_KEY}`) {
        answer = {
          status: 401,
          body: {
            error: {
              message: 'Invalid API Key',
              type: 'invalid_request_error',
              code: 'invalid_api_key',
            },
          },
        };
      } else {
        const queue = queues.get(route);
        const handler = queue?.length ? queue.shift() : defaults[route];
        answer = handler
          ? handler(request)
          : {
              status: 404,
              body: { error: { message: 'Unknown request URL', type: 'invalid_request_error' } },
            };
      }
      res.writeHead(answer.status, {
        'Content-Type': 'application/json',
        ...(answer.headers ?? {}),
      });
      res.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/openai/v1`,
    requests,
    /**
     * @description Queue the answer of the next request of a route.
     * @param {string} route - "POST /openai/v1/chat/completions", "GET /openai/v1/models".
     * @param {Function|object} handler - `(request) => answer`, or the answer.
     */
    reply(route, handler) {
      if (!queues.has(route)) {
        queues.set(route, []);
      }
      queues.get(route).push(typeof handler === 'function' ? handler : () => handler);
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
