# ADR-0007: Re-run base on every PR; no stored baselines

- Status: accepted (2026-10-03)

## Context
Stored baselines go stale when the judge model, its server version or the suite changes. The comparison would then mix different yardsticks without anyone noticing.

## Decision
The action re-runs the head's suite against the base checkout on every PR. Both runs share the same judge, suite and runner within minutes of each other.

## Consequences
- CI eval cost is about twice that of a single run. `repeats` and suite size are the cost knobs.

## What I gave up
- Uploading baseline artifacts from `main` and downloading them on PRs (cheaper, but stale and harder to trust). This is a candidate for v0.2 behind a flag.
