# ADR-0005: Composite GitHub Action with a single-file esbuild bundle

- Status: accepted (2026-10-03)

## Context
The action has to check out base, run user code twice and post a comment. JavaScript actions need a committed `dist/` and `@actions/*` toolkits. Docker actions are slow and Linux-only.

## Decision
- `action.yml` is a **composite** action. It runs setup-node 24, builds evalgate if `dist/cli.js` is missing (`corepack pnpm install --frozen-lockfile && pnpm build`), runs head, adds a `git worktree` for base and runs base (with an optional `base-setup` command), runs compare, writes `$GITHUB_STEP_SUMMARY`, posts or edits the PR comment with `gh`, and then fails the job if there was a regression.
- All user inputs reach shell steps through `env:` and are never interpolated into scripts (to prevent script injection).
- `scripts/build.mjs` bundles `src/bin.ts` with esbuild into one ESM file, adding a `createRequire` banner so CommonJS deps (ajv) still work.

## Consequences
- The first run on a ref without `dist/` pays the install and build cost. Release tags can commit `dist/` later to skip it.
- `gh pr comment --edit-last` edits the token's last comment. It falls back to a new comment, and on fork PRs with read-only tokens it only warns.

## What I gave up
- `@actions/github` / Octokit (more dependencies). Docker (slow, Linux-only).
