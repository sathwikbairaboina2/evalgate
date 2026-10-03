#!/usr/bin/env bash
# Evaluate the head checkout. Env: EVALGATE, SUITE, RUNNER_TEMP, optional HEAD_TARGET_URL.
set -euo pipefail

args=()
if [ -n "${HEAD_TARGET_URL:-}" ]; then args+=(--target-url "$HEAD_TARGET_URL"); fi

node "$EVALGATE" run "$SUITE" --out "$RUNNER_TEMP/evalgate-head.json" "${args[@]+"${args[@]}"}"
