import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { normalizeConfig, presetName } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';
import { buildUsageWidget, compactTokens, LIMITS_URL, requestsLeftTile } from '../src/widgets.js';

const NOW = Date.UTC(2026, 10, 1, 17, 0, 0);
const day = (date, tokens) => ({ date, tokens });
const snapshot = {
  today_key: '2026-11-01',
  today: {
    requests: 42,
    errors: 2,
    prompt_tokens: 180_000,
    completion_tokens: 12_400,
    cached_tokens: 150_000,
    by_use: {},
  },
  month: {
    requests: 420,
    errors: 2,
    prompt_tokens: 1_800_000,
    completion_tokens: 124_000,
    cached_tokens: 1_500_000,
  },
  days: [day('2026-10-30', 95_000), day('2026-10-31', 240_000), day('2026-11-01', 192_400)],
  last_request: {
    at: NOW - 120_000,
    use: 'chat',
    model: 'openai/gpt-oss-120b',
    ms: 1400,
    ok: true,
  },
  last_error: {
    at: NOW - 3_600_000,
    use: 'router',
    model: 'openai/gpt-oss-20b',
    kind: 'too_large',
    message: 'HTTP 413',
  },
};
const empty = {
  today_key: '2026-11-01',
  today: {
    requests: 0,
    errors: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    cached_tokens: 0,
    by_use: {},
  },
  month: { requests: 0, errors: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 },
  days: [],
  last_request: null,
  last_error: null,
};
const LIMITS = {
  at: NOW - 60_000,
  requests: { limit: 1000, remaining: 958, resetAt: NOW + 3_600_000 },
  tokens: { limit: 8000, remaining: 6200 },
};

const budget = (content) => {
  const count = (types) => content.components.filter((c) => types.includes(c.type)).length;
  assert.ok(content.components.length <= 8, `${content.components.length} components`);
  assert.ok(count(['value', 'gauge']) <= 6);
  assert.ok(count(['text']) <= 2);
  assert.ok(count(['chart', 'card-list', 'image']) <= 1);
  assert.ok(count(['status']) <= 1);
  assert.ok(count(['button']) <= 4);
};

test('every state gives a valid content within the budget, in every language', () => {
  const configured = normalizeConfig({ api_key: 'k' });
  const cases = [
    { snapshot, config: configured, failing: null, limits: LIMITS },
    { snapshot, config: configured, failing: { kind: 'auth', since: NOW - 600_000 } },
    { snapshot: empty, config: configured, failing: null },
    {
      snapshot,
      config: configured,
      failing: null,
      limits: { ...LIMITS, requests: { ...LIMITS.requests, remaining: 0 } },
    },
    { snapshot, config: normalizeConfig(), failing: null, limits: LIMITS },
    {
      snapshot,
      config: normalizeConfig({
        api_key: 'k',
        model: 'custom',
        custom_model: 'meta-llama/llama-5-scout-17b-16e-instruct',
      }),
      failing: null,
    },
  ];
  for (const language of LANGUAGES) {
    for (const options of cases) {
      const content = buildUsageWidget({
        ...options,
        modelName: presetName,
        language,
        now: NOW,
        timeZone: 'Europe/Paris',
      });
      assert.deepEqual(validateWidgetContent(content), [], language);
      budget(content);
    }
  }
});

test('the numbers of the day, the tokens per day, the requests left, the failing state', () => {
  const content = buildUsageWidget({
    snapshot,
    config: normalizeConfig({ api_key: 'k' }),
    failing: { kind: 'rate_limit', since: NOW - 600_000 },
    limits: LIMITS,
    modelName: presetName,
    language: 'fr',
    now: NOW,
    timeZone: 'Europe/Paris',
  });
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.value),
    [42, compactTokens(192_400, 'fr'), compactTokens(1_924_000, 'fr'), 2, '958/1000'],
  );
  assert.equal(tiles[3].color, 'warning');
  assert.equal(tiles[4].color, 'success');
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.unit, 'k');
  assert.deepEqual(
    chart.series[0].points.map((point) => point.v),
    [95, 240, 192.4],
  );
  const status = content.components.find((c) => c.type === 'status');
  assert.equal(status.items[0].color, 'danger');
  assert.match(status.items[0].value, /En erreur depuis 17:50/);
  assert.equal(status.items[1].value, 'GPT-OSS 120B · GPT-OSS 20B');
  assert.match(status.items[2].value, /discussion, il y a 2 min \(1,4 s\)/);
  assert.match(status.items[3].value, /requête trop grosse/);
  const link = content.components.find((c) => c.type === 'button');
  assert.equal(link.link.url, LIMITS_URL);
});

test('the requests left: colored, hidden when unknown, old or past their reset', () => {
  assert.equal(requestsLeftTile(null, NOW, 'en'), null);
  assert.equal(requestsLeftTile({ ...LIMITS, at: NOW - 25 * 3600_000 }, NOW, 'en'), null);
  assert.equal(
    requestsLeftTile({ ...LIMITS, requests: { ...LIMITS.requests, resetAt: NOW - 1 } }, NOW, 'en'),
    null,
  );
  assert.equal(
    requestsLeftTile({ ...LIMITS, requests: { limit: null, remaining: 3 } }, NOW, 'en'),
    null,
  );
  const tile = (remaining) =>
    requestsLeftTile({ ...LIMITS, requests: { ...LIMITS.requests, remaining } }, NOW, 'en');
  assert.equal(tile(0).color, 'danger');
  assert.equal(tile(50).color, 'warning');
  assert.equal(tile(500).color, 'success');
});

test('without a key: a message instead of the chart, no requests left tile', () => {
  const content = buildUsageWidget({
    snapshot,
    config: normalizeConfig(),
    failing: null,
    limits: LIMITS,
    language: 'en',
    now: NOW,
  });
  assert.ok(content.components.some((c) => c.type === 'text' && c.variant === 'body'));
  assert.ok(!content.components.some((c) => c.type === 'chart'));
  assert.equal(content.components.filter((c) => c.type === 'value').length, 4);
});

test('token counts stay short', () => {
  assert.equal(compactTokens(850, 'en'), '850');
  assert.equal(compactTokens(12_400, 'en'), '12.4 k');
  assert.equal(compactTokens(50_298, 'de'), '50,3 k');
  assert.equal(compactTokens(715_632, 'es'), '716 k');
  assert.equal(compactTokens(1_924_000, 'fr'), '1,9 M');
  assert.equal(compactTokens(NaN, 'fr'), '0');
  assert.ok(compactTokens(123_456_789_012, 'de').length <= 12);
});
