# ADR-0002: The gate is a paired sign-flip permutation test plus a min-delta, critical cases, and fail-closed errors

- Status: accepted (2026-10-03)

## Context
LLM agents are noisy. A gate that fails on any drop gets turned off within a week. A gate that compares only aggregate means misses a single catastrophic case, such as a leaked system prompt.

## Decision
The gate fails (exit 1) if **any** of these hold:
1. **Fail closed:** any case errored on head (target crash, timeout, or judge failure). We cannot vouch for what we could not measure.
2. **Critical cases:** any case marked `critical: true` regressed (diff <= -caseThreshold).
3. **Aggregate:** mean paired diff <= -minDelta (and < 0), **and** the one-sided paired sign-flip permutation p-value < alpha.

The permutation test is exact for 16 pairs or fewer (2^n sign patterns) and uses seeded Monte Carlo above that (mulberry32, `seed`, `permutations`), so the same inputs always give the same verdict. Defaults: minDelta 0.02, alpha 0.1, caseThreshold 0.5.

Drops that are not significant are reported as warnings ("treated as noise"). Errors are never converted into a score of 0.

## Consequences
- With binary scorers and 10 cases, a non-critical drop must reach 4 cases (p = 0.0625) to fail at alpha 0.1. Teams should mark must-never-break cases as critical, and the toy example does this.
- `repeats` lowers noise per case without changing the test.

## What I gave up
- Bootstrap confidence intervals (needs more cases to be stable and is not exact for small n).
- Per-case significance with a multiple-comparison correction (too few repeats in CI to be meaningful).
- A t-test (assumes normality, which fails badly for 0/1 scores).
