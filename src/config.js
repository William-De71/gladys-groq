// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the administrator in Gladys from the `config_schema` of the
// manifest; the SDK fetches it (`gladys.getConfig()`) and notifies every
// change (`gladys.onConfigUpdated()`). This module provides the defaults and
// normalizes what arrives, so the rest of the code never deals with
// `undefined`, a number typed as a string, or a model the select no longer
// offers.
// -----------------------------------------------------------------------------

/**
 * The models offered in the Configuration screen, with what the Groq docs say
 * about them (console.groq.com/docs/models, reasoning, vision, read on
 * 2026-11-23). Groq has no "latest" aliases: these are the model ids, which
 * Groq retires with notice (docs: deprecations); "Other model" covers the
 * rest and the successors.
 *
 *   - `efforts`  the `reasoning_effort` values the model accepts (anything
 *                else is a 400), from the least to the most;
 *   - `images`   it reads the images of the chat;
 *   - `maxOutput` the largest `max_completion_tokens` it accepts;
 *   - `preview`  a preview model, which Groq may remove at short notice.
 */
export const MODELS = {
  'openai/gpt-oss-120b': {
    name: 'GPT-OSS 120B',
    efforts: ['low', 'medium', 'high'],
    images: false,
    maxOutput: 65_536,
    preview: false,
  },
  'openai/gpt-oss-20b': {
    name: 'GPT-OSS 20B',
    efforts: ['low', 'medium', 'high'],
    images: false,
    maxOutput: 65_536,
    preview: false,
  },
  'qwen/qwen3.8-27b': {
    name: 'Qwen 3.8 27B',
    efforts: ['none', 'low', 'medium', 'high'],
    images: true,
    maxOutput: 16_384,
    preview: true,
  },
};

/** The values of each select, in the order of the manifest. */
export const CHAT_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
export const ROUTER_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];

export const CUSTOM_MODEL = 'custom';

/** The reasoning levels of the configuration (`reasoning` select). */
export const REASONING_LEVELS = ['none', 'low', 'medium', 'high'];

/**
 * The service tiers of the configuration (`service_tier` select, docs:
 * service-tiers): `on_demand` is Groq's default, `flex` (paid plans) has
 * higher limits but may fail at once when busy, `auto` takes the best tier
 * the organization has.
 */
export const SERVICE_TIERS = ['on_demand', 'auto', 'flex'];

/** A Groq model id typed by hand: `name` or `vendor/name`. */
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99})?$/;

/** Bounds of the `max_tokens` field, mirrored by the manifest. */
export const MAX_TOKENS_MIN = 1024;
export const MAX_TOKENS_MAX = 32000;

// Defaults: they MUST stay consistent with the `default` values declared in
// the `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // The Groq API key. A `secret` field: no default, never logged.
  api_key: '',
  // The model of the chat, the scene `ai.ask` action and the weekly digest.
  model: 'openai/gpt-oss-120b',
  // The model of the intent router, which runs before every chat turn and must
  // answer within 20 s.
  fast_model: 'openai/gpt-oss-20b',
  // The id used by a select set to "custom".
  custom_model: '',
  // How hard the chat model thinks.
  reasoning: 'low',
  // Output budget of one answer (reasoning included). Kept small: on the free
  // plan Groq counts it against the 8,000 tokens a minute.
  max_tokens: 4096,
  // The service tier of every request.
  service_tier: 'on_demand',
};

/**
 * @description Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] - Config returned by the SDK.
 * @returns {object} The normalized config.
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  const customModel = String(config.custom_model ?? '').trim();
  return {
    api_key: String(config.api_key ?? '').trim(),
    model: pickModel(config.model, CHAT_MODELS, DEFAULT_CONFIG.model),
    fast_model: pickModel(config.fast_model, ROUTER_MODELS, DEFAULT_CONFIG.fast_model),
    custom_model: MODEL_ID_PATTERN.test(customModel) ? customModel : '',
    reasoning: REASONING_LEVELS.includes(config.reasoning)
      ? config.reasoning
      : DEFAULT_CONFIG.reasoning,
    max_tokens: clampInteger(config.max_tokens, MAX_TOKENS_MIN, MAX_TOKENS_MAX),
    service_tier: SERVICE_TIERS.includes(config.service_tier)
      ? config.service_tier
      : DEFAULT_CONFIG.service_tier,
  };
}

/**
 * @description The model id to call for a select value.
 * @param {object} config - The normalized config.
 * @param {'model'|'fast_model'} key - Which select.
 * @returns {string|null} The API model id, null when "custom" has no id.
 */
export function resolveModel(config, key) {
  const value = config[key];
  if (value === CUSTOM_MODEL) {
    return config.custom_model || null;
  }
  return value;
}

/**
 * @description The display name of a model id.
 * @param {string} id - An API model id.
 * @returns {string} "GPT-OSS 120B", or the id itself.
 */
export function presetName(id) {
  return MODELS[id]?.name ?? id;
}

/**
 * @description The `reasoning_effort` to send for a model and a wanted level.
 * A known model gets the closest level it accepts (GPT-OSS cannot turn
 * reasoning off: `none` becomes `low`); an unknown one gets nothing for
 * `none`, else the level as asked (a 400 makes the chat drop it).
 * @param {string|null} model - The model id.
 * @param {string} level - `none`, `low`, `medium` or `high`.
 * @returns {string|undefined} The effort, undefined to send none.
 */
export function effortFor(model, level) {
  const efforts = MODELS[model]?.efforts;
  if (!efforts) {
    return level === 'none' ? undefined : level;
  }
  if (efforts.includes(level)) {
    return level;
  }
  const order = REASONING_LEVELS;
  const wanted = order.indexOf(level);
  // The closest level the model accepts; on a tie, the lower one (faster).
  return [...efforts].sort(
    (a, b) =>
      Math.abs(order.indexOf(a) - wanted) - Math.abs(order.indexOf(b) - wanted) ||
      order.indexOf(a) - order.indexOf(b),
  )[0];
}

/**
 * @description The `max_completion_tokens` to send: the configuration, raised
 * to what the caller asks, bounded by the model.
 * @param {string|null} model - The model id.
 * @param {number} configured - The `max_tokens` of the configuration.
 * @param {number} [asked] - The `max_tokens` of the core request.
 * @returns {number} Tokens.
 */
export function outputBudget(model, configured, asked = 0) {
  const wanted = Math.min(MAX_TOKENS_MAX, Math.max(configured, Number(asked) || 0));
  return Math.min(wanted, MODELS[model]?.maxOutput ?? MAX_TOKENS_MAX);
}

/**
 * @description A select value kept when offered by that select, else the default.
 * @param {unknown} value - The value.
 * @param {Array<string>} offered - The values of the select.
 * @param {string} fallback - The default.
 * @returns {string} A model id or "custom".
 */
function pickModel(value, offered, fallback) {
  if (value === CUSTOM_MODEL || offered.includes(value)) {
    return value;
  }
  return fallback;
}

/**
 * @description An integer within bounds.
 * @param {unknown} value - The value.
 * @param {number} min - The minimum.
 * @param {number} max - The maximum.
 * @returns {number} The integer.
 */
function clampInteger(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return DEFAULT_CONFIG.max_tokens;
  }
  return Math.min(max, Math.max(min, number));
}
