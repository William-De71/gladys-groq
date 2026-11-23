import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_TTL_MS, createCatalog, summarize } from '../src/catalog.js';
import { MODELS } from './helpers/fake-groq.js';

test('a catalog entry keeps whether the model is active and its limits', () => {
  assert.deepEqual(summarize(MODELS[0]), {
    id: 'openai/gpt-oss-120b',
    active: true,
    context: 131072,
    maxOutput: 65536,
  });
  assert.equal(summarize({ id: 'a/b', active: false }).active, false);
  assert.equal(summarize({ id: 'a/b' }).context, null);
});

test('the catalog is read once, again after 12 hours, and kept on failure', async () => {
  let now = 1_000_000;
  let calls = 0;
  let fail = false;
  const errors = [];
  const catalog = createCatalog({
    fetchModels: async () => {
      calls += 1;
      if (fail) {
        throw new Error('down');
      }
      return MODELS;
    },
    now: () => now,
    onError: (err) => errors.push(err.message),
  });
  assert.equal(catalog.loaded(), false);
  assert.equal(catalog.name('openai/gpt-oss-20b'), 'GPT-OSS 20B');
  await catalog.ensure();
  await catalog.ensure();
  assert.equal(calls, 1);
  assert.equal(catalog.lookup('qwen/qwen3.8-27b').maxOutput, 16384);
  assert.equal(catalog.lookup('nope/model'), undefined);
  now += CATALOG_TTL_MS + 1;
  fail = true;
  await catalog.ensure();
  assert.equal(calls, 2);
  assert.deepEqual(errors, ['down']);
  assert.ok(catalog.lookup('openai/gpt-oss-120b'), 'the old list stays');
  await catalog.ensure();
  assert.equal(calls, 2, 'no new try within 10 minutes of a failure');
  assert.equal(catalog.name(null), '–');
  assert.equal(catalog.name('meta-llama/llama-5-scout'), 'meta-llama/llama-5-scout');
});

test('a list read by the key check is kept; an empty one is ignored', () => {
  const catalog = createCatalog({ fetchModels: async () => [] });
  catalog.accept([]);
  assert.equal(catalog.loaded(), false);
  catalog.accept(MODELS);
  assert.equal(catalog.loaded(), true);
});
