# ADR-0006: Tests use dependency injection with no network, a fake judge, and seeded randomness

- Status: accepted (2026-10-03)

## Decision
- Every I/O edge is injected: `fetch` (judge and HTTP target), the `Target` function, the `Judge` interface, and CLI `Io` (stdout, stderr, env, fetch, cwd). The CLI's `main()` returns an exit code instead of calling `process.exit`, so tests can call it in-process.
- Unit tests use fake judges and fake `fetch`. The CLI test fake `fetch` throws "network disabled in tests".
- Command-target tests spawn the real node binary (no network) so the timeout, exit-code, env and cwd handling are real.
- Permutation p-values are exact or seeded, so assertions are exact numbers.
- Live Ollama runs are manual (`evalgate calibrate`), never part of `pnpm test`.

## What I gave up
- Recorded HTTP fixtures (nock or polly): more machinery for little gain at this size.
