# Judge calibration

## What exists today

`examples/calibration/support-labels.yaml` has 16 items (8 pass, 8 fail). The project author labelled them for illustration, and most answers are clear-cut. The measured result (kappa 1.000 with `qwen3.8:27b`, see `2026-10-03-qwen3.8-27b.md`) is weak evidence: it shows the judge handles an easy policy, not that it matches a team's own labels on borderline answers.

## Protocol for the harder set (left for the maintainer)

This labelling needs human raters and is not done by the build. Steps:

1. Collect at least 50 items from real agent outputs for one rubric. About half should be borderline: partly right, right but hedged, right with an unsupported extra promise, or wrong in a small detail.
2. Have two humans label every item pass or fail on their own, without seeing the judge's verdicts or each other's labels.
3. Report the human-human kappa. It is the ceiling for the judge. If it is low, fix the rubric before blaming the judge.
4. Settle disagreements by discussion and keep the agreed label. Record how many items needed it.
5. Write the items in the same format as `examples/calibration/support-labels.yaml` (name, judge, rubric, items with `id`, `input`, `output`, `label`).
6. Run `docker compose --profile ollama run --rm calibrate` (or `evalgate calibrate <file> --min-kappa 0.6`).
7. Report judge-human kappa next to human-human kappa, with the item count and the confusion matrix.

Do not tune the rubric on the same items you report. Keep a held-out part or write fresh items.
