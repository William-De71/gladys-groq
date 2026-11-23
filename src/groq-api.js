// -----------------------------------------------------------------------------
// Client of the Groq API (https://api.groq.com/openai/v1, OpenAI compatible).
//
// Plain fetch, no SDK: two endpoints only —
//   - POST /chat/completions   the assistant and the web search action
//   - GET  /models             the models of the key (spends nothing: also
//                              the key check)
//
// Every call runs under a deadline. A 429, a 498 (flex tier at capacity) or a
// 5xx is retried while the deadline leaves room for it, honouring
// Retry-After; anything else fails at once with a GroqError that says what
// went wrong without echoing the key.
//
// Groq sends its rate limits with every answer (docs: rate-limits): the
// requests left today (RPD) and the tokens left this minute (TPM), per
// model. They are kept here, by model, for the widget and the status.
// -----------------------------------------------------------------------------

export const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

/** The error kinds, also the `kind` variable of the `error` scene trigger. */
export const ERROR_KINDS = {
  AUTH: 'auth',
  SPEND_LIMIT: 'spend_limit',
  MODEL: 'model',
  RATE_LIMIT: 'rate_limit',
  TOO_LARGE: 'too_large',
  REQUEST: 'request',
  SERVER: 'server',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
};

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 8000;
const MAX_ATTEMPTS = 3;

export class GroqError extends Error {
  /**
   * @param {string} kind - One of ERROR_KINDS.
   * @param {string} message - What went wrong (never the key).
   * @param {object} [details] - `{ status, retryAfterMs, code }`.
   */
  constructor(kind, message, { status = null, retryAfterMs = null, code = null } = {}) {
    super(message);
    this.name = 'GroqError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

/**
 * @description The kind of a failure, from its HTTP status, the `code` of the
 * error body and its message.
 * @param {number} status - The HTTP status.
 * @param {string|null} [code] - `error.code` (`invalid_api_key`,
 * `model_not_found`, `rate_limit_exceeded`, `tool_use_failed`…).
 * @param {string} [message] - `error.message`.
 * @returns {string} One of ERROR_KINDS.
 */
export function kindOf(status, code = null, message = '') {
  const text = String(message ?? '');
  if (code === 'invalid_api_key' || status === 401) {
    return ERROR_KINDS.AUTH;
  }
  if (/spend(ing)? limit|spend cap|billing limit/i.test(text)) {
    return ERROR_KINDS.SPEND_LIMIT;
  }
  if (
    code === 'model_not_found' ||
    code === 'model_decommissioned' ||
    code === 'model_terms_required' ||
    status === 403 ||
    status === 404
  ) {
    return ERROR_KINDS.MODEL;
  }
  if (status === 413) {
    // "Request too large for model … on tokens per minute (TPM): Limit 8000,
    // Requested 9655": the request is bigger than what the plan allows in a
    // minute. It fails the same way every time, until the plan changes.
    return /per minute|TPM|tokens/i.test(text) ? ERROR_KINDS.TOO_LARGE : ERROR_KINDS.REQUEST;
  }
  if (status === 429 || status === 498 || code === 'rate_limit_exceeded') {
    return ERROR_KINDS.RATE_LIMIT;
  }
  if (status === 408) {
    return ERROR_KINDS.TIMEOUT;
  }
  if (status >= 500) {
    return ERROR_KINDS.SERVER;
  }
  // 400 bad request or invalid tool call, 422: this request only.
  return ERROR_KINDS.REQUEST;
}

/**
 * @description Hide what looks like a key.
 * @param {string} text - A text.
 * @returns {string} The text, keys masked.
 */
export function maskKeys(text) {
  return String(text ?? '')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/gsk_[a-zA-Z0-9]+/g, 'gsk_***');
}

/**
 * @description The message of an error body, short and without secrets.
 * @param {unknown} body - The parsed body, or the raw text.
 * @returns {string} The message.
 */
export function errorMessageOf(body) {
  let message = '';
  if (typeof body === 'string') {
    message = body;
  } else if (body && typeof body === 'object') {
    const error = body.error && typeof body.error === 'object' ? body.error : body;
    const candidate = error.message ?? body.message ?? body.error;
    message = typeof candidate === 'string' ? candidate : JSON.stringify(candidate ?? '');
    // An invalid tool call says why (docs: tool-use, "Error Handling").
    const reason = error.failed_generation?.reason;
    if (typeof reason === 'string' && reason && !message.includes(reason)) {
      message += ` (${reason})`;
    }
  }
  return maskKeys(message).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * @description Milliseconds asked by a Retry-After header.
 * @param {string|null} value - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Milliseconds, null when absent or unreadable.
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * @description A Groq duration ("2m59.56s", "7.66s", "120ms", "1h2m3s") in ms.
 * @param {string|null} value - The header.
 * @returns {number|null} Milliseconds, null when unreadable.
 */
export function parseDuration(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const text = value.trim();
  const units = { h: 3600_000, m: 60_000, s: 1000, ms: 1 };
  let total = 0;
  let matched = '';
  for (const part of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(part[1]) * units[part[2]];
    matched += part[0];
  }
  return matched === text ? Math.round(total) : null;
}

/**
 * @description The rate limits of an answer (docs: rate-limits, "Rate Limit
 * Headers"). The request headers count per day (RPD), the token headers per
 * minute (TPM).
 * @param {Headers} headers - The headers of the answer.
 * @param {number} now - Now (ms).
 * @returns {object|null} `{ at, requests: { limit, remaining, resetAt }, tokens: { limit, remaining } }`.
 */
export function readLimits(headers, now = Date.now()) {
  const number = (name) => {
    const value = Number(headers?.get?.(name));
    return headers?.get?.(name) !== null && Number.isFinite(value) ? value : null;
  };
  const requestsLimit = number('x-ratelimit-limit-requests');
  const requestsLeft = number('x-ratelimit-remaining-requests');
  const tokensLimit = number('x-ratelimit-limit-tokens');
  const tokensLeft = number('x-ratelimit-remaining-tokens');
  if (requestsLimit === null && tokensLimit === null) {
    return null;
  }
  const reset = parseDuration(headers.get('x-ratelimit-reset-requests'));
  return {
    at: now,
    requests: {
      limit: requestsLimit,
      remaining: requestsLeft,
      resetAt: reset === null ? null : now + reset,
    },
    tokens: { limit: tokensLimit, remaining: tokensLeft },
  };
}

/**
 * @description Build a client.
 * @param {object} options - Options.
 * @param {() => string} options.getApiKey - The current API key.
 * @param {string} [options.baseUrl] - The API root (tests point it to a fake).
 * @param {typeof fetch} [options.fetchImpl] - fetch.
 * @param {(ms: number) => Promise<void>} [options.sleep] - Waiting (tests skip it).
 * @param {() => number} [options.now] - Clock.
 * @returns {object} `{ chat, models, limits }`.
 */
export function createGroqClient({
  getApiKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const root = baseUrl.replace(/\/+$/, '');
  // The last rate limits seen, by model.
  const limits = new Map();

  /**
   * @description One HTTP call, retried on 429 / 498 / 5xx / network while
   * the deadline allows.
   * @param {string} method - GET or POST.
   * @param {string} path - Path under /openai/v1.
   * @param {object} [options] - `{ body, timeoutMs, retries }`.
   * @returns {Promise<object>} The parsed JSON body.
   */
  async function request(method, path, { body, timeoutMs = 30_000, retries = true } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new GroqError(ERROR_KINDS.AUTH, 'No Groq API key in the configuration');
    }
    const deadline = now() + timeoutMs;
    let lastError = null;
    for (let attempt = 1; attempt <= (retries ? MAX_ATTEMPTS : 1); attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        break;
      }
      try {
        return await once(method, path, body, apiKey, remaining);
      } catch (err) {
        lastError = err;
        const retryable =
          err.kind === ERROR_KINDS.RATE_LIMIT ||
          err.kind === ERROR_KINDS.SERVER ||
          err.kind === ERROR_KINDS.UNREACHABLE;
        if (!retryable || !retries || attempt === MAX_ATTEMPTS) {
          throw err;
        }
        const wait = err.retryAfterMs ?? RETRY_BASE_MS * 2 ** (attempt - 1);
        // A long wait asked by Groq (the requests or tokens of the day are
        // spent), or no room left for the wait and a useful answer: fail now,
        // with the real reason, rather than later with a timeout.
        if (wait > RETRY_MAX_MS || now() + wait + 1000 >= deadline) {
          throw err;
        }
        await sleep(wait);
      }
    }
    throw (
      lastError ??
      new GroqError(ERROR_KINDS.TIMEOUT, `No answer within ${Math.round(timeoutMs / 1000)} s`)
    );
  }

  async function once(method, path, body, apiKey, timeoutMs) {
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new GroqError(
          ERROR_KINDS.TIMEOUT,
          `No answer within ${Math.round(timeoutMs / 1000)} s`,
        );
      }
      throw new GroqError(
        ERROR_KINDS.UNREACHABLE,
        `Cannot reach the Groq API (${err?.cause?.code ?? err?.message ?? 'network error'})`,
      );
    }
    if (typeof body?.model === 'string') {
      const seen = readLimits(response.headers, now());
      if (seen) {
        limits.set(body.model, seen);
      }
    }
    const text = await response.text().catch(() => '');
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const message = errorMessageOf(parsed ?? text) || response.statusText || 'error';
      const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : null;
      throw new GroqError(
        kindOf(response.status, code, message),
        `HTTP ${response.status}: ${message}`,
        {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), now()),
          code,
        },
      );
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new GroqError(ERROR_KINDS.SERVER, 'The Groq API answered something that is not JSON', {
        status: response.status,
      });
    }
    return parsed;
  }

  return {
    /**
     * @description POST /chat/completions.
     * @param {object} body - A chat completion request.
     * @param {object} [options] - `{ timeoutMs, retries }`.
     * @returns {Promise<object>} The completion.
     */
    chat(body, options) {
      return request('POST', '/chat/completions', { ...options, body });
    },
    /**
     * @description GET /models: the models the key can use (spends nothing,
     * proves the key is valid).
     * @param {object} [options] - `{ timeoutMs }`.
     * @returns {Promise<Array<object>>} The models.
     */
    async models(options) {
      const body = await request('GET', '/models', {
        timeoutMs: 15_000,
        retries: false,
        ...options,
      });
      return Array.isArray(body?.data) ? body.data : [];
    },
    /**
     * @description The last rate limits Groq sent for a model.
     * @param {string|null} model - A model id.
     * @returns {object|null} See readLimits().
     */
    limits(model) {
      return (model && limits.get(model)) || null;
    },
  };
}
