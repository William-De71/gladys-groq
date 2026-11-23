// -----------------------------------------------------------------------------
// Scene action `web_search`: a question answered by GPT-OSS with the browser
// search tool built into Groq (`tools: [{ type: "browser_search" }]`, docs:
// tool-use/built-in-tools/browser-search). The chat of Gladys has no web
// access; this action gives a scene a fresh answer ("the news of the day",
// "is the A7 motorway blocked?") to send in a notification.
//
// Only the GPT-OSS models have the tool: the chat model when it is one, else
// GPT-OSS 120B. The search runs on Groq's side (powered by Exa) and costs
// tokens only, many of them: the pages read are counted as input. Reasoning
// stays `low`, as the docs advise, so the search stays short.
//
// The answer holds citation marks such as 【2†L6-L10】, which mean nothing in
// an SMS: they are removed. The sources, when Groq lists them with the
// executed tool, come back as a separate output.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { outputBudget, resolveModel } from './config.js';
import { textOf } from './convert.js';
import { ERROR_KINDS, GroqError } from './groq-api.js';

const logger = createLogger({ name: 'web-search' });

export const WEB_SEARCH_TIMEOUT_MS = 85_000;
/** The model of the search when the chat model has no browser search. */
export const SEARCH_FALLBACK_MODEL = 'openai/gpt-oss-120b';
const MAX_QUESTION = 1000;
const MAX_ANSWER = 10_000;
const MAX_SOURCES = 5;

const INSTRUCTIONS =
  'You answer for a home automation scene: the text may be read aloud or sent as a phone notification. ' +
  'Search the web when the question needs fresh facts. Answer in the language of the question, briefly ' +
  '(a few sentences), in plain text without Markdown, links, citation marks or source list.';

/**
 * @description The model of the search: the chat model when it has the
 * browser search tool, else GPT-OSS 120B.
 * @param {string|null} model - The chat model.
 * @returns {string} A GPT-OSS model id.
 */
export function searchModel(model) {
  return typeof model === 'string' && model.startsWith('openai/gpt-oss-')
    ? model
    : SEARCH_FALLBACK_MODEL;
}

/**
 * @description Every `{ title, url }` found in the executed tools of a
 * message, whatever their nesting (the shape is not documented).
 * @param {unknown} value - `message.executed_tools`.
 * @param {Array<{ title: string, url: string }>} [found] - The sources so far.
 * @param {number} [depth] - The depth reached.
 * @returns {Array<{ title: string, url: string }>} The sources.
 */
export function collectSources(value, found = [], depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6 || found.length >= 50) {
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSources(item, found, depth + 1);
    }
    return found;
  }
  if (typeof value.url === 'string' && /^https?:\/\//.test(value.url)) {
    found.push({ title: String(value.title ?? '').trim(), url: value.url });
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      collectSources(child, found, depth + 1);
    }
  }
  return found;
}

/**
 * @description The answer and the sources of a completion.
 * @param {object} response - The chat completion.
 * @returns {{ answer: string, sources: Array<{ title: string, url: string }> }} What was found.
 */
export function readAnswer(response) {
  const message = response?.choices?.[0]?.message ?? {};
  const sources = [];
  const seen = new Set();
  for (const source of collectSources(message.executed_tools)) {
    if (!seen.has(source.url)) {
      seen.add(source.url);
      sources.push(source);
    }
  }
  const answer = textOf(message.content)
    // 【2†L6-L10】 marks of the browser tool, and "[1]" style markers.
    .replace(/\s*【[^】]*】/g, '')
    .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '')
    .trim();
  return { answer, sources };
}

/**
 * @description The sources as one text: "Title — https://…" per line.
 * @param {Array<{ title: string, url: string }>} sources - The sources.
 * @returns {string} The lines.
 */
export function formatSources(sources) {
  return sources
    .slice(0, MAX_SOURCES)
    .map(({ title, url }) => [title, url].filter(Boolean).join(' — '))
    .join('\n');
}

/**
 * @description Create the scene action handler.
 * @param {object} options - Options.
 * @param {object} options.client - The Groq client.
 * @param {() => object} options.getConfig - The normalized config.
 * @param {object} [options.usage] - The usage store.
 * @param {(err: GroqError, context: object) => void} [options.onFailure] - Failure hook.
 * @param {() => void} [options.onSuccess] - Success hook.
 * @param {() => number} [options.now] - Clock.
 * @returns {(fields: object) => Promise<object>} The handler: `{ answer, sources }`.
 */
export function createWebSearchHandler({
  client,
  getConfig,
  usage,
  onFailure = () => {},
  onSuccess = () => {},
  now = Date.now,
}) {
  return async function webSearch(fields = {}) {
    const question = String(fields.question ?? '').trim();
    if (!question) {
      throw new Error('The question is empty');
    }
    const config = getConfig();
    const model = searchModel(resolveModel(config, 'model'));
    const started = now();
    try {
      const extra = String(fields.instructions ?? '').trim();
      const body = {
        model,
        messages: [
          {
            role: 'system',
            content: extra ? `${INSTRUCTIONS}\n${extra.slice(0, MAX_QUESTION)}` : INSTRUCTIONS,
          },
          { role: 'user', content: question.slice(0, MAX_QUESTION) },
        ],
        tools: [{ type: 'browser_search' }],
        tool_choice: 'required',
        reasoning_effort: 'low',
        include_reasoning: false,
        max_completion_tokens: outputBudget(model, config.max_tokens),
        user: 'gladys',
      };
      if (config.service_tier !== 'on_demand') {
        body.service_tier = config.service_tier;
      }
      const response = await client.chat(body, { timeoutMs: WEB_SEARCH_TIMEOUT_MS });
      const { answer, sources } = readAnswer(response);
      if (!answer) {
        throw new GroqError(ERROR_KINDS.SERVER, 'The model returned no text for this question');
      }
      const ms = now() - started;
      logger.info(
        `web search: answered in ${(ms / 1000).toFixed(1)} s with ${sources.length} source(s)`,
      );
      usage?.recordSuccess({ use: 'web', model, usage: response?.usage, ms });
      onSuccess();
      return { answer: answer.slice(0, MAX_ANSWER), sources: formatSources(sources) };
    } catch (err) {
      const error =
        err instanceof GroqError
          ? err
          : new GroqError(ERROR_KINDS.SERVER, err?.message ?? String(err));
      logger.warn(`web search failed (${error.kind}): ${error.message}`);
      usage?.recordError({ use: 'web', model, kind: error.kind, message: error.message });
      onFailure(error, { use: 'web', model });
      throw error;
    }
  };
}
