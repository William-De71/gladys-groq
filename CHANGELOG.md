# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-11-23

### Added

- **ai:** the Gladys AI provider on Groq, with the administrator's own API key: the chat and its tool calls, the intent router, the scene "ask the AI" action and the weekly digest
- **models:** a chat model and a router model among GPT-OSS 120B, GPT-OSS 20B, Qwen 3.8 27B (reads images) or any other Groq model id; reasoning level adapted to what each model accepts; service tier (on demand, auto, flex); one more try when the model writes an invalid tool call
- **limits:** the requests left today from the rate limit headers of Groq; a request larger than the tokens per minute of the plan named as such and never retried
- **scenes:** "ask with web search" action (Groq browser search with GPT-OSS, answer and sources as outputs); triggers when the assistant fails (key refused, spending limit, rate limit, request too large, model unavailable, API unreachable) and when it answers again
- **widgets:** requests, tokens of the day and of the month, requests left today, tokens per day over 30 days, last answer and last error
- **configuration:** "Test the connection" button; connection status checked without spending anything
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-groq/releases/tag/v0.1.0
