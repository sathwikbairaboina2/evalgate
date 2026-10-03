# ADR-0004: Calibration reports Cohen's kappa and a confusion matrix, leaves out judge errors, and has an optional --min-kappa gate

- Status: accepted (2026-10-03)

## Context
An LLM judge is another model that proposes verdicts, so we need evidence that it agrees with humans before it can gate merges. Raw agreement is misleading when classes are unbalanced.

## Decision
- `evalgate calibrate labels.yaml` grades each human-labelled item **one at a time** (judges are often a shared local model). It reports Cohen's kappa (binary), raw agreement, the confusion matrix (rows human, columns judge), a Landis & Koch interpretation, the run duration, and every disagreement with the judge's reason.
- Judge errors are counted and left out of the kappa rather than guessed.
- Kappa is `null` ("n/a") when expected agreement is 1 (only one class present), so it never divides by zero.
- `--min-kappa x` exits 1 below the floor, so calibration can itself be a CI check.

## What I gave up
- Krippendorff's alpha or multi-rater agreement (v0.1 assumes one human label per item).
- Automatic prompt tuning to raise kappa (that would overfit the labelled set).
