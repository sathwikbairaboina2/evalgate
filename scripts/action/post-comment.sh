#!/usr/bin/env bash
# Create or update the evalgate PR comment. A failure is a warning, never a failed job.
# Env: EVALGATE, GITHUB_TOKEN, GITHUB_REPOSITORY, PR, FILE.
set -euo pipefail

if ! node "$EVALGATE" comment --repo "$GITHUB_REPOSITORY" --pr "$PR" --body-file "$FILE"; then
  echo "::warning::evalgate: could not post the PR comment (read-only token on a fork PR?)"
fi
