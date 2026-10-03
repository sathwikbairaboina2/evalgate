#!/usr/bin/env bash
# Evaluate the base ref in a throwaway git worktree.
# Env: EVALGATE, SUITE, RUNNER_TEMP, BASE_REF, optional BASE_SETUP, BASE_TARGET_URL.
set -euo pipefail

if [ -z "${BASE_REF:-}" ]; then
  echo "::error::evalgate: no base-ref given and this is not a pull_request event"
  exit 2
fi

BASE_DIR="$RUNNER_TEMP/evalgate-base"

# A previous run on a self-hosted runner can leave the worktree registered in .git/worktrees.
git worktree remove --force "$BASE_DIR" 2>/dev/null || true
rm -rf "$BASE_DIR"
git worktree prune

git worktree add --detach "$BASE_DIR" "$BASE_REF"
cleanup() { git worktree remove --force "$BASE_DIR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ -n "${BASE_SETUP:-}" ]; then (cd "$BASE_DIR" && bash -c "$BASE_SETUP"); fi

args=()
if [ -n "${BASE_TARGET_URL:-}" ]; then args+=(--target-url "$BASE_TARGET_URL"); fi

node "$EVALGATE" run "$SUITE" --workdir "$BASE_DIR/$(dirname "$SUITE")" --out "$RUNNER_TEMP/evalgate-base.json" "${args[@]+"${args[@]}"}"
