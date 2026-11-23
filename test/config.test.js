import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MODELS,
  DEFAULT_CONFIG,
  effortFor,
  MODELS,
  normalizeConfig,
  outputBudget,
  presetName,
  resolveModel,
  ROUTER_MODELS,
} from '../src/config.js';

test('defaults fill an empty or broken configuration', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  const config = normalizeConfig({
    api_key: '  gsk_abc  ',
    model: 'gpt-5',
    fast_model: 'custom',
    custom_model: 'bad id with spaces',
    reasoning: 'max',
    max_tokens: '999999',
    service_tier: 'performance',
  });
  assert.equal(config.api_key, 'gsk_abc');
  assert.equal(config.model, 'openai/gpt-oss-120b', 'an unknown model falls back');
  assert.equal(config.fast_model, 'custom');
  assert.equal(config.custom_model, '', 'an id that cannot be a model id is ignored');
  assert.equal(config.reasoning, 'low');
  assert.equal(config.max_tokens, 32000);
  assert.equal(config.service_tier, 'on_demand', 'performance is for enterprise plans');
  assert.equal(normalizeConfig({ max_tokens: 'x' }).max_tokens, 4096);
  assert.equal(normalizeConfig({ max_tokens: 10 }).max_tokens, 1024);
  assert.equal(normalizeConfig({ service_tier: 'flex' }).service_tier, 'flex');
});

test('each select keeps only its values, every preset is described', () => {
  assert.equal(normalizeConfig({ model: 'qwen/qwen3.8-27b' }).model, 'qwen/qwen3.8-27b');
  assert.equal(
    normalizeConfig({ fast_model: 'openai/gpt-oss-120b' }).fast_model,
    'openai/gpt-oss-120b',
  );
  for (const id of [...CHAT_MODELS, ...ROUTER_MODELS]) {
    assert.ok(MODELS[id], id);
  }
});

test('a select set to "custom" calls the custom id, null when it is empty', () => {
  for (const id of ['meta-llama/llama-5-scout', 'llama-3.1-8b-instant', 'moonshotai/kimi-k3']) {
    const config = normalizeConfig({ model: 'custom', custom_model: ` ${id} ` });
    assert.equal(resolveModel(config, 'model'), id);
    assert.equal(resolveModel(config, 'fast_model'), 'openai/gpt-oss-20b');
  }
  assert.equal(resolveModel(normalizeConfig({ model: 'custom' }), 'model'), null);
  assert.equal(presetName('qwen/qwen3.8-27b'), 'Qwen 3.8 27B');
  assert.equal(presetName('x/y'), 'x/y');
});

test('the effort is the closest level the model accepts, the lower one on a tie', () => {
  assert.equal(effortFor('openai/gpt-oss-120b', 'none'), 'low');
  assert.equal(effortFor('openai/gpt-oss-120b', 'medium'), 'medium');
  assert.equal(effortFor('qwen/qwen3.8-27b', 'none'), 'none');
  assert.equal(effortFor('x/y', 'none'), undefined);
  assert.equal(effortFor('x/y', 'high'), 'high');
});

test('the output budget follows the configuration, the caller and the model', () => {
  assert.equal(outputBudget('openai/gpt-oss-120b', 4096), 4096);
  assert.equal(outputBudget('openai/gpt-oss-120b', 4096, 9000), 9000);
  assert.equal(outputBudget('openai/gpt-oss-120b', 4096, 99999), 32000);
  assert.equal(outputBudget('qwen/qwen3.8-27b', 32000), 16384);
  assert.equal(outputBudget('x/y', 2048, 'x'), 2048);
});
