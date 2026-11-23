# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** that makes **Groq** (open models
such as OpenAI GPT-OSS and Qwen, served on Groq's LPU chips) the AI provider
of a Gladys instance: a Node.js service (Node 22+, ESM, no build step) in its
own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the official Groq API (`https://api.groq.com/openai/v1`, OpenAI
compatible) with the administrator's API key. Runtime dependency: the SDK only
(plain `fetch`, no Groq client). `type: "ai"`, Gladys 5.3.0+,
`transports: ["cloud"]`, `categories: ["assistants"]`. Not affiliated with
Groq.

The contract (SDK README, "AI providers"): one OpenAI-compatible chat
completion in (`messages`, `tools`, `tool_choice`, `max_tokens`, `purpose`,
`categories`, no `model`), one OpenAI-compatible completion out. The agentic
loop (prompts, tools, history) runs in the core; this integration only picks
the model and prepares the request. **Never tested with a real Groq key**:
request and response shapes follow the API reference (console.groq.com/docs,
`llms.txt` and the `.md` pages, read on 2026-11-23); only the 401 of a wrong
key was captured from the real API.

## Commands

```bash
npm install
npm test                                  # node --test; a fake Groq API on 127.0.0.1
node --test test/chat.test.js             # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/manifest.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js              SDK wiring only (new GladysIntegration + createApp)
src/app.js            every handler: onAiChat, web search scene action, test button,
                      widget, configuration, status following the requests
src/chat.js           the AI provider: model per purpose, reasoning_effort per model,
                      retry without it when refused, one retry on tool_use_failed,
                      images only to models that read them, cut answers, usage, hooks
src/convert.js        messages of the core -> Groq: calls and results paired
                      (placeholder ids, lone calls, orphans, duplicates), images;
                      the answer bounded, reasoning never kept
src/catalog.js        GET /models (12 h): which ids exist and are active
src/groq-api.js       fetch client: chat, models, rate limits per model from the
                      x-ratelimit-* headers; deadline, retries on 429 / 498 / 5xx /
                      network with Retry-After, 413 "too large" never retried, keys masked
src/websearch.js      scene action: GPT-OSS with the browser_search built-in tool
src/events.js         triggers: error (once per failure kind), recovered
src/usage.js          /data/usage.json: requests, tokens, cached tokens per local day
src/widgets.js        the usage widget (tokens, requests left today)
src/connection.js     status (GET /models, nothing spent) and the test button
src/config.js         model presets with their efforts / images / max output, custom id,
                      reasoning, max_tokens, service tier; effortFor(), outputBudget()
src/i18n.js           runtime texts, en / fr / de / es
src/time.js           local days and times (TZ of Gladys, Intl only)
test/helpers/fake-groq.js        the fake API (chat, models, rate limit headers, 401)
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **Every key users store is forever**: the keys of `config_schema` and the
  values of the `model` / `fast_model` / `reasoning` / `service_tier`
  selects, `actions`, the widget, the triggers (fields, options, variables),
  the scene action (fields, outputs). `test/structure.test.js` compares them
  to `test/fixtures/manifest.baseline.json`: never update it to make a test
  pass without a documented migration. A new scene action field is optional or
  has a default.
- **Model presets are Groq model ids**: Groq has no "latest" aliases and
  retires models with notice. When a preset is retired, keep its value in the
  select only if Groq redirects it; otherwise add the successor, move the
  default, and let `normalizeConfig` map the old stored value to the default
  (document it in the changelog). "Other model" covers the rest.
- **Reasoning**: only the efforts `MODELS[id].efforts` lists are sent (a value
  outside the set is a 400); GPT-OSS has no `none`. `include_reasoning: false`
  goes with every effort: the reasoning is never sent back (Groq asks to pass
  back only final answers) and never reaches the core.
- **Deadlines of the core**: the ack is awaited 20 s for
  `intent-classification`, 120 s otherwise; the handler gives up at 18 s and
  110 s. Retries (429, 498, 5xx, network) only while the deadline leaves room;
  a Retry-After longer than 8 s fails at once (daily limits). A 413 "request
  too large" (TPM of the plan) is kind `too_large`, never retried: it fails the
  same way until the plan or `max_tokens` changes.
- **Never fall back silently**: a failure throws (the core names it to the
  user); never answer from another provider or model, never return an empty
  turn.
- **Calls and results stay paired**: placeholder ids of the core (`unknown`,
  `tool_call_unknown`) get a stable made-up id, results take the open calls in
  order, a call left alone gets `MISSING_OUTPUT`, an orphan result is dropped.
- **The completion is bounded like the core does** (`validateAiCompletion`):
  `content` a string or null, at most 20 tool calls, names
  `^[a-zA-Z0-9_-]{1,64}$`, `arguments` a JSON string, ids at most 128
  characters.
- **Web search**: only GPT-OSS has `browser_search`; the chat model when it is
  one, else GPT-OSS 120B. `reasoning_effort` low (docs advice: shorter
  searches). Citation marks `【…】` are removed; the sources are a separate
  output, read from `executed_tools` whatever their nesting.
- **Scene events** once per transition: `error` when the failure kind changes,
  `recovered` at the first answer after. A refused request (`request` kind:
  HTTP 400, 422, invalid tool call twice, image to a text model) starts nothing
  and does not change the status.
- **The API key** is a `secret`: never logged, never in /data, never in an
  error message (`maskKeys` hides `gsk_…` and `Bearer …`).
- **The container rootfs is read-only.** Write only under `/data` (usage
  counters, written at most every 10 s and at shutdown).
- **Four languages.** Every user-facing text (manifest, `src/i18n.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted". Tile labels stay within about 13
  characters (the dashboard truncates them).
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Logo**: the Groq wordmark (Wikimedia Commons trace, CC BY-SA 4.0) names
  the service only; keep the "not affiliated" notices.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- A wrong or revoked key is a 401 "Invalid API Key", code `invalid_api_key`
  (captured 2026-11-23). `GET /models` proves the key without spending
  anything.
- The free plan allows about 8,000 tokens a minute per model: Groq counts the
  prompt plus `max_completion_tokens`, so a big home with a big answer budget
  gets a 413 at every message. Cached prompt tokens do not count.
- `x-ratelimit-*-requests` headers are per DAY, `x-ratelimit-*-tokens` per
  MINUTE; durations look like `2m59.56s` (`parseDuration`).
- `max_tokens` is deprecated by Groq: send `max_completion_tokens`. It counts
  the reasoning: a `length` answer may carry no text. Qwen 3.8 27B stops at
  16,384.
- Qwen 3.8 27B is a preview model and takes at most 3 images per request.
- `AbortSignal.timeout` does not keep the process alive: a test that waits on
  it needs its own timer.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
