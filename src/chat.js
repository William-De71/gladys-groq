// -----------------------------------------------------------------------------
// The AI provider: one OpenAI chat completion in, one out, answered by Groq.
//
// The whole agentic loop (prompts, tools, history) stays in the Gladys core:
// this handler picks the model, prepares the request (convert.js), calls
// /chat/completions and bounds the answer. It runs no tool.
//
// What each `purpose` gets:
//   - `intent-classification` (the router, before every chat turn): the
//     router model with the least reasoning it accepts, under 18 s (the core
//     waits 20 s);
//   - `chat`, `weekly-digest` and anything else: the chat model at the
//     reasoning level of the configuration, under 110 s (the core waits 120 s).
//
// Groq checks the tool calls a model writes and answers 400 `tool_use_failed`
// when one is not valid JSON or names no tool (docs: tool-use, "Error
// Handling"); it advises to try again, which is done once, while time allows.
// -----------------------------------------------------------------------------

import { AI_CHAT_PURPOSES, createLogger } from '@gladysassistant/integration-sdk';
import { effortFor, MODELS, outputBudget, resolveModel } from './config.js';
import {
  hasImages,
  toGroqMessages,
  toGroqToolChoice,
  toGroqTools,
  toOpenAiCompletion,
} from './convert.js';
import { ERROR_KINDS, GroqError } from './groq-api.js';

const logger = createLogger({ name: 'chat' });

export const CHAT_TIMEOUT_MS = 110_000;
export const ROUTER_TIMEOUT_MS = 18_000;
/** A second try after an invalid tool call needs at least this much time. */
const RETRY_MIN_MS = 5_000;

/**
 * @description The use counted for a purpose.
 * @param {string} purpose - The `purpose` of the request.
 * @returns {string} `router`, `digest` or `chat`.
 */
export function useOf(purpose) {
  if (purpose === AI_CHAT_PURPOSES.INTENT_CLASSIFICATION) {
    return 'router';
  }
  if (purpose === AI_CHAT_PURPOSES.WEEKLY_DIGEST) {
    return 'digest';
  }
  return 'chat';
}

/**
 * @description Build the Groq request of a core request.
 * @param {object} request - `{ messages, tools?, tool_choice?, max_tokens?, purpose }`.
 * @param {object} config - The normalized config.
 * @param {object} [options] - Options.
 * @param {Set<string>} [options.noReasoning] - Models that refused `reasoning_effort`.
 * @returns {object} The body.
 */
export function buildBody(request, config, { noReasoning = new Set() } = {}) {
  const router = request?.purpose === AI_CHAT_PURPOSES.INTENT_CLASSIFICATION;
  const model = resolveModel(config, router ? 'fast_model' : 'model');
  if (!model) {
    throw new GroqError(
      ERROR_KINDS.MODEL,
      'The configuration chooses another model but its id is empty',
    );
  }
  if (MODELS[model]?.images === false && hasImages(request?.messages)) {
    throw new GroqError(
      ERROR_KINDS.REQUEST,
      `${MODELS[model].name} cannot read images: choose Qwen 3.8 27B as the chat model`,
    );
  }
  const body = {
    model,
    messages: toGroqMessages(request?.messages),
    // The caller's `max_tokens` is sized for an answer without reasoning.
    max_completion_tokens: outputBudget(model, config.max_tokens, request?.max_tokens),
    // A stable pseudonym, as the API reference suggests (abuse detection).
    user: 'gladys',
  };
  const tools = toGroqTools(request?.tools);
  if (tools.length > 0) {
    body.tools = tools;
    const choice = toGroqToolChoice(request?.tool_choice);
    if (choice !== undefined) {
      body.tool_choice = choice;
    }
  }
  if (!noReasoning.has(model)) {
    const effort = effortFor(model, router ? 'none' : config.reasoning);
    if (effort !== undefined) {
      body.reasoning_effort = effort;
      // The reasoning is not used: not sent back, and the docs ask to pass
      // back only the final answers.
      body.include_reasoning = false;
    }
  }
  if (config.service_tier !== 'on_demand') {
    body.service_tier = config.service_tier;
  }
  return body;
}

/**
 * @description Whether a refusal is about the reasoning parameters.
 * @param {unknown} err - The error.
 * @returns {boolean} True for a 400 that names them.
 */
function refusedReasoning(err) {
  return (
    err instanceof GroqError &&
    err.kind === ERROR_KINDS.REQUEST &&
    err.status === 400 &&
    /reasoning|effort/i.test(err.message)
  );
}

/**
 * @description Whether a refusal is an invalid tool call written by the model.
 * @param {unknown} err - The error.
 * @returns {boolean} True for a 400 `tool_use_failed`.
 */
function invalidToolCall(err) {
  return (
    err instanceof GroqError &&
    err.status === 400 &&
    (err.code === 'tool_use_failed' || /tool call|failed_generation/i.test(err.message))
  );
}

/**
 * @description Create the `onAiChat` handler.
 * @param {object} options - Options.
 * @param {object} options.client - The Groq client.
 * @param {() => object} options.getConfig - The normalized config.
 * @param {object} [options.catalog] - The model catalog.
 * @param {object} [options.usage] - The usage store (usage.js).
 * @param {(err: GroqError, context: object) => void} [options.onFailure] - Failure hook.
 * @param {() => void} [options.onSuccess] - Success hook.
 * @param {() => number} [options.now] - Clock.
 * @returns {(request: object) => Promise<object>} The handler.
 */
export function createChatHandler({
  client,
  getConfig,
  catalog,
  usage,
  onFailure = () => {},
  onSuccess = () => {},
  now = Date.now,
}) {
  // Models that refused `reasoning_effort`: never sent to them again until the
  // integration restarts.
  const noReasoning = new Set();
  const name = (id) => catalog?.name(id) ?? id;

  return async function onAiChat(request) {
    const config = getConfig();
    const use = useOf(request?.purpose);
    const router = use === 'router';
    const timeoutMs = router ? ROUTER_TIMEOUT_MS : CHAT_TIMEOUT_MS;
    const started = now();
    const left = () => timeoutMs - (now() - started);
    let body;
    try {
      body = buildBody(request, config, { noReasoning });
      let response;
      let retriedToolCall = false;
      for (;;) {
        try {
          response = await client.chat(body, { timeoutMs: Math.max(1000, left()) });
          break;
        } catch (err) {
          if (body.reasoning_effort && refusedReasoning(err)) {
            logger.warn(
              `${body.model} refused reasoning_effort ${body.reasoning_effort}: sent without it from now on`,
            );
            noReasoning.add(body.model);
            const { reasoning_effort: _effort, include_reasoning: _include, ...rest } = body;
            body = rest;
            continue;
          }
          if (!retriedToolCall && invalidToolCall(err) && left() > RETRY_MIN_MS) {
            logger.warn(`${body.model} wrote an invalid tool call: asked again once`);
            retriedToolCall = true;
            continue;
          }
          throw err;
        }
      }
      const completion = toOpenAiCompletion(response);
      const message = completion.choices[0].message;
      const finish = completion.choices[0].finish_reason;
      const ms = now() - started;
      if (!message.content && !message.tool_calls) {
        if (finish === 'length') {
          throw new GroqError(
            ERROR_KINDS.REQUEST,
            `The answer was cut at max_tokens (${body.max_completion_tokens}) before any text: raise it in the configuration`,
          );
        }
        if (finish === 'content_filter') {
          throw new GroqError(ERROR_KINDS.REQUEST, 'Groq filtered the answer');
        }
      }
      if (finish === 'length') {
        logger.warn(
          `The answer hit max_tokens (${body.max_completion_tokens}): raise it in the configuration`,
        );
      }
      const tokens = response?.usage ?? {};
      const cached = Number(tokens.prompt_tokens_details?.cached_tokens) || 0;
      logger.info(
        `${request?.purpose ?? 'chat'}: ${name(body.model)} answered in ${(ms / 1000).toFixed(1)} s` +
          ` (${tokens.prompt_tokens ?? '?'} in${cached ? `, ${cached} cached` : ''}, ${tokens.completion_tokens ?? '?'} out` +
          `${message.tool_calls ? `, ${message.tool_calls.length} tool call(s)` : ''})`,
      );
      usage?.recordSuccess({ use, model: body.model, usage: response?.usage, ms });
      onSuccess();
      return completion;
    } catch (err) {
      const error =
        err instanceof GroqError
          ? err
          : new GroqError(ERROR_KINDS.SERVER, err?.message ?? String(err));
      logger.warn(`${request?.purpose ?? 'chat'} failed (${error.kind}): ${error.message}`);
      usage?.recordError({ use, model: body?.model, kind: error.kind, message: error.message });
      onFailure(error, { use, model: body?.model });
      throw error;
    }
  };
}
