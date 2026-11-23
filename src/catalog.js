// -----------------------------------------------------------------------------
// The models of the key (GET /models, a few dozen entries).
//
// Groq lists only the id, the owner, whether the model is active, its context
// window and its largest answer: no name, no capabilities. The list is used to
// tell the administrator at once that a model id is wrong or retired, instead
// of failing at the first chat message. Names and capabilities of the models
// of the selects come from config.js.
//
// Read at the first need and every 12 hours. A failure keeps the last list:
// the catalog helps, it is never needed to answer.
// -----------------------------------------------------------------------------

import { presetName } from './config.js';

export const CATALOG_TTL_MS = 12 * 3600_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

/**
 * @description The part of a catalog entry kept in memory.
 * @param {object} model - An entry of GET /models.
 * @returns {object} `{ id, active, context, maxOutput }`.
 */
export function summarize(model) {
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    id: String(model?.id ?? ''),
    active: model?.active !== false,
    context: number(model?.context_window),
    maxOutput: number(model?.max_completion_tokens),
  };
}

/**
 * @description Build the catalog cache.
 * @param {object} options - Options.
 * @param {() => Promise<Array<object>>} options.fetchModels - `client.models`.
 * @param {() => number} [options.now] - Clock.
 * @param {(err: Error) => void} [options.onError] - Failures (logged).
 * @returns {object} `{ refresh, ensure, lookup, name, loaded, accept }`.
 */
export function createCatalog({ fetchModels, now = Date.now, onError = () => {} }) {
  let entries = new Map();
  let loadedAt = 0;
  let failedAt = 0;
  let pending = null;

  /**
   * @description Keep a list read elsewhere (the key check reads it too).
   * @param {Array<object>} models - The entries of GET /models.
   */
  function accept(models) {
    if (Array.isArray(models) && models.length > 0) {
      entries = new Map(models.map((model) => [String(model.id), summarize(model)]));
      loadedAt = now();
    }
  }

  async function refresh() {
    if (pending) {
      return pending;
    }
    pending = (async () => {
      try {
        accept(await fetchModels());
      } catch (err) {
        failedAt = now();
        onError(err);
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  return {
    refresh,
    accept,

    /**
     * @description The list, read again when older than 12 hours (and not
     * after a failure of less than 10 minutes).
     * @returns {Promise<void>} When it is as fresh as it can be.
     */
    async ensure() {
      const stale = entries.size === 0 || now() - loadedAt > CATALOG_TTL_MS;
      const cooling = failedAt > 0 && now() - failedAt < RETRY_AFTER_FAILURE_MS;
      if (stale && !cooling) {
        await refresh();
      }
    },

    /**
     * @param {string|null} id - A model id.
     * @returns {object|undefined} Its summary.
     */
    lookup(id) {
      return id ? entries.get(id) : undefined;
    },

    /**
     * @param {string|null} id - A model id.
     * @returns {string} Its display name ("GPT-OSS 120B"), or the id.
     */
    name(id) {
      return id ? presetName(id) : '–';
    },

    /** @returns {boolean} Whether a list was read. */
    loaded() {
      return entries.size > 0;
    },
  };
}
