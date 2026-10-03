# ADR-0003: The judge is any OpenAI-compatible endpoint, gives a binary verdict, uses plain fetch, and is injected for tests

- Status: accepted (2026-10-03)

## Context
Users run judges on OpenAI, on gateways, or locally (the dev default is Ollama at `http://localhost:11434/v1` with `qwen3.8:27b`). Unit tests must not touch the network.

## Decision
- `POST {baseUrl}/chat/completions` through an injected `fetch`, with no vendor SDK. Temperature 0. `extraBody` is merged in so provider-specific knobs (such as reasoning settings) work without code changes.
- The prompt asks for `{"verdict":"pass"|"fail","reason":"..."}`. The parser strips `<think>...</think>` and takes the first `{...}` object. Anything else raises `JudgeError`, which makes the case `error` (ADR-0002) and never counts as a pass.
- Each scorer gives a binary verdict, so judge agreement can be measured with Cohen's kappa (ADR-0004).

## What I gave up
- 1-10 graded scales (judges are poorly calibrated on them, and they would need weighted kappa).
- Logprob-based confidence (not available on every OpenAI-compatible server).
- Function-calling or structured-output modes (not supported everywhere, and plain JSON in text works on all servers).
