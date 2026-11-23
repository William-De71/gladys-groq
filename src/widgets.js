// -----------------------------------------------------------------------------
// Dashboard widget of the Groq integration.
//
//   - `usage`  what the assistant asked Groq: requests and errors of the day,
//              tokens of the day and of the month, and the requests the chat
//              model has left today, from the rate limit headers of its last
//              answer (tiles); tokens per day over 30 days (bar chart); the
//              state, the models, the last answer and the last error
//              (status); a link to the limits page of GroqCloud.
//
// Counted by the integration from the `usage` of every answer (usage.js):
// requests made outside Gladys with the same organization are not in it.
// Groq gives no cost: the usage page of GroqCloud is the reference for the
// bill. Every text exists in the four languages (the content is cached per
// language). Budget of a card: 8 components, 1 main one, 6 tiles, 2 texts
// (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { resolveModel } from './config.js';
import { ago, formatNumber, t } from './i18n.js';
import { formatTime } from './time.js';

export const WIDGETS = { USAGE: 'usage' };
const TTL_SECONDS = 60;
export const LIMITS_URL = 'https://console.groq.com/settings/limits';
/** Rate limits older than this say nothing about today. */
const LIMITS_MAX_AGE_MS = 24 * 3600_000;

const LOCALES = ['en', 'fr', 'de', 'es'];

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A token count, short: "850", "12.4 k", "1.2 M" ("12,4 k" in
 * French). Not Intl's compact notation: German and Spanish do not shorten the
 * thousands with it ("50.298").
 * @param {number} value - Tokens.
 * @param {string} language - The language.
 * @returns {string} The text (≤ 12 characters).
 */
export function compactTokens(value, language) {
  const number = Number.isFinite(value) && value > 0 ? value : 0;
  const format = (amount) =>
    new Intl.NumberFormat(LOCALES.includes(language) ? language : 'en', {
      maximumFractionDigits: amount < 100 ? 1 : 0,
    }).format(amount);
  if (number >= 999_950) {
    return clip(`${format(number / 1e6)} M`, 12);
  }
  if (number >= 1000) {
    return clip(`${format(number / 1000)} k`, 12);
  }
  return String(Math.round(number));
}

/**
 * @description The tile of the requests the chat model has left today.
 * @param {object|null} limits - `client.limits(model)`.
 * @param {number} now - Now (ms).
 * @param {string} language - The language.
 * @returns {object|null} A `value` component, null when unknown or too old.
 */
export function requestsLeftTile(limits, now, language) {
  const requests = limits?.requests;
  if (
    !requests ||
    !Number.isFinite(requests.remaining) ||
    !Number.isFinite(requests.limit) ||
    requests.limit <= 0 ||
    now - limits.at > LIMITS_MAX_AGE_MS ||
    (Number.isFinite(requests.resetAt) && requests.resetAt <= now)
  ) {
    return null;
  }
  const left = Math.max(0, requests.remaining);
  return {
    type: 'value',
    label: clip(t('tileRequestsLeft', language), 24),
    value: clip(`${left}/${requests.limit}`, 12),
    icon: 'battery',
    color:
      left === 0
        ? WIDGET_COLORS.DANGER
        : left < requests.limit / 10
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.SUCCESS,
  };
}

/**
 * @description The "usage" widget.
 * @param {object} options - Options.
 * @param {object} options.snapshot - `usage.snapshot()`.
 * @param {object} options.config - The normalized config.
 * @param {object|null} options.failing - `events.state()`.
 * @param {object|null} [options.limits] - The rate limits of the chat model.
 * @param {(id: string|null) => string} [options.modelName] - Display names.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} [options.timeZone] - The timezone of Gladys.
 * @returns {object} The content.
 */
export function buildUsageWidget({
  snapshot,
  config,
  failing,
  limits = null,
  modelName = (id) => id ?? '–',
  language,
  now,
  timeZone,
}) {
  const time = (instant) => formatTime(instant, { language, timeZone, now });
  const chat = resolveModel(config, 'model');
  const router = resolveModel(config, 'fast_model');
  const components = [];

  if (!config.api_key) {
    components.push({ type: 'text', variant: 'body', text: clip(t('widgetNoKey', language), 300) });
  }

  const today = snapshot.today;
  components.push(
    {
      type: 'value',
      label: clip(t('tileRequestsToday', language), 24),
      value: today.requests,
      icon: 'message-circle',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      label: clip(t('tileTokensToday', language), 24),
      value: compactTokens(today.prompt_tokens + today.completion_tokens, language),
      icon: 'hash',
      color: WIDGET_COLORS.INFO,
    },
    {
      type: 'value',
      label: clip(t('tileTokensMonth', language), 24),
      value: compactTokens(
        snapshot.month.prompt_tokens + snapshot.month.completion_tokens,
        language,
      ),
      icon: 'calendar',
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: clip(t('tileErrorsToday', language), 24),
      value: today.errors,
      icon: 'alert-triangle',
      color: today.errors > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
  );
  const left = config.api_key ? requestsLeftTile(limits, now, language) : null;
  if (left) {
    components.push(left);
  }

  // Without a key the body text takes the place of the chart (8 components).
  if (config.api_key && snapshot.days.some((day) => day.tokens > 0)) {
    components.push({
      type: 'chart',
      chart_type: 'bar',
      title: clip(t('chartTokensTitle', language), 60),
      // Thousands: whole token counts read badly on the axis ("100000.00").
      unit: 'k',
      series: [
        {
          name: t('chartTokensSeries', language),
          points: snapshot.days.map((day) => ({
            t: `${day.date}T12:00:00Z`,
            v: Math.round(day.tokens / 100) / 10,
          })),
        },
      ],
    });
  }

  const items = [];
  if (failing) {
    items.push({
      label: clip(t('rowState', language), 40),
      value: clip(t('stateFailing', language, { time: time(failing.since) }), 40),
      color: WIDGET_COLORS.DANGER,
    });
  } else {
    items.push({
      label: clip(t('rowState', language), 40),
      value: clip(t(config.api_key ? 'stateOk' : 'stateNoKey', language), 40),
      color: config.api_key ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }
  items.push({
    label: clip(t('rowModels', language), 40),
    value: clip(
      chat === router ? modelName(chat) : `${modelName(chat)} · ${modelName(router)}`,
      40,
    ),
    color: WIDGET_COLORS.NEUTRAL,
  });
  const last = snapshot.last_request;
  items.push({
    label: clip(t('rowLastRequest', language), 40),
    value: clip(
      last
        ? last.ok && last.ms
          ? t('valueLastRequestTime', language, {
              use: t(`use_${last.use}`, language),
              ago: ago(last.at, now, language),
              seconds: formatNumber(last.ms / 1000, language, 1),
            })
          : t('valueLastRequest', language, {
              use: t(`use_${last.use}`, language),
              ago: ago(last.at, now, language),
            })
        : t('never', language),
      40,
    ),
    color: !last ? WIDGET_COLORS.NEUTRAL : last.ok ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  });
  const error = snapshot.last_error;
  if (error) {
    items.push({
      label: clip(t('rowLastError', language), 40),
      value: clip(`${time(error.at)} · ${t(`kind_${error.kind}`, language)}`, 40),
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: clip(t('buttonLimits', language), 24),
    icon: 'external-link',
    style: 'secondary',
    link: { url: LIMITS_URL },
  });

  return { ttl_seconds: TTL_SECONDS, components };
}
