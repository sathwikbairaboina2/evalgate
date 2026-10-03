# Architecture decision records

| ADR | Decision |
| --- | --- |
| [0001](0001-suite-format-and-head-yardstick.md) | YAML suites validated with zod; the head's suite is the yardstick for both sides |
| [0002](0002-regression-gate.md) | Paired sign-flip permutation test + min-delta + critical cases + fail-closed errors |
| [0003](0003-judge-openai-compatible-binary.md) | Judge: any OpenAI-compatible endpoint, binary verdict, plain fetch |
| [0004](0004-calibration-cohens-kappa.md) | Calibration: Cohen's kappa + confusion matrix, errors excluded, `--min-kappa` |
| [0005](0005-composite-action-esbuild-bundle.md) | Composite GitHub Action + single-file esbuild bundle |
| [0006](0006-testing-without-network.md) | Tests: dependency injection, no network, fake judge, seeded randomness |
| [0007](0007-no-cached-baselines.md) | Re-run base on every PR; no stored baselines |
| [0008](0008-pr-comment-upsert-by-marker.md) | PR comment: find by marker and edit through the REST API, failure is a warning |
| [0009](0009-action-scripts-local-e2e.md) | Action steps in `scripts/action/`, actionlint + ShellCheck gate, local e2e in a temp git repo |
