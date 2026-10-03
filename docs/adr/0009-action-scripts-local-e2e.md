# ADR-0009: Action steps live in scripts, linted, with a local end-to-end test

- Status: accepted (2026-10-04)

## Context
The bash for the action's steps was inline in `action.yml`. actionlint does not check the bash inside a composite action, so it was never linted or run by any test. A real GitHub PR run needs a pushed repo, which is outside the autonomous build.

## Decision
- The steps move to `scripts/action/{evaluate-head,evaluate-base,compare,post-comment}.sh`. `action.yml` only sets env vars and calls them.
- `pnpm lint:actions` runs actionlint and ShellCheck from one pinned image (`rhysd/actionlint:1.7.12`) over the workflows and every script. CI runs the same command.
- `tests/action.test.ts` runs the scripts in a temp git repo (base commit good, head commit regressed) with the same env the action sets. It checks `regression=true`, the comment content, the step summary, that no worktree is left behind, that a second base run works, and the empty `base-ref` error.
- The base script removes a stale worktree before adding one (`worktree remove`, `rm -rf`, `worktree prune`) and removes it again on exit. This fixes the second run on a self-hosted runner.

## Consequences
- The step logic is lintable, testable and runnable by hand.
- The e2e test runs on Windows (Git Bash) and in the Docker `build` stage, which now installs `git`.

## What I gave up
- The local run does not exercise `actions/setup-node`, the real `pull_request` event payload, or token permissions. A real PR run, including a fork PR, stays with the maintainer.
- The test skips when bash or git is missing, so it can be silently absent on a minimal machine.
