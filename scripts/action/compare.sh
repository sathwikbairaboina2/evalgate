#!/usr/bin/env bash
# Compare the base and head results, write the comment and the step outputs.
# Env: EVALGATE, RUNNER_TEMP, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, optional MIN_DELTA, ALPHA, CASE_THRESHOLD.
set -euo pipefail

args=()
if [ -n "${MIN_DELTA:-}" ]; then args+=(--min-delta "$MIN_DELTA"); fi
if [ -n "${ALPHA:-}" ]; then args+=(--alpha "$ALPHA"); fi
if [ -n "${CASE_THRESHOLD:-}" ]; then args+=(--case-threshold "$CASE_THRESHOLD"); fi

COMMENT="$RUNNER_TEMP/evalgate-comment.md"
set +e
node "$EVALGATE" compare --base "$RUNNER_TEMP/evalgate-base.json" --head "$RUNNER_TEMP/evalgate-head.json" --comment "$COMMENT" "${args[@]+"${args[@]}"}"
code=$?
set -e

echo "comment-path=$COMMENT" >> "$GITHUB_OUTPUT"
if [ -f "$COMMENT" ]; then cat "$COMMENT" >> "$GITHUB_STEP_SUMMARY"; fi
if [ "$code" -eq 0 ]; then
  echo "regression=false" >> "$GITHUB_OUTPUT"
elif [ "$code" -eq 1 ]; then
  echo "regression=true" >> "$GITHUB_OUTPUT"
else
  exit "$code"
fi
