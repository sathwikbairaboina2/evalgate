# ADR-0001: YAML suites validated with zod; the head's suite is the yardstick for both sides

- Status: accepted (2026-10-03)

## Context
A regression check is only fair if base and head are measured against the same cases and scorers. The suite also has to be easy to read in a PR diff and hard to get silently wrong.

## Decision
- Suites are YAML files, parsed with `yaml` and validated with `zod` strict objects. Unknown keys, duplicate case ids, invalid regexes and invalid JSON Schemas are rejected at load time with path-specific messages (exit code 2).
- The suite file is always read from the **head** checkout. The base run reuses that file and only points the target at the base checkout (`--workdir`, or `--target-url` for HTTP targets).
- Judge API keys are never stored in YAML: `apiKeyEnv` names an environment variable, and HTTP header values support `${ENV}` expansion.

## Consequences
- A PR that adds cases shows them as `added`, not as a regression. A PR that deletes cases produces a warning, so lost coverage stays visible.
- A PR that changes a case's scorer re-scores base with the new scorer, which is the intended effect.

## What I gave up
- Defining suites in TypeScript (more flexible, but it executes arbitrary code at config time and is harder to diff).
- Reading the base's own suite (it would measure base against a different yardstick).
