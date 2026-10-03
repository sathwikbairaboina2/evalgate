# ADR-0008: Upsert the PR comment by its marker through the REST API

- Status: accepted (2026-10-04)

## Context
The action posted its comment with `gh pr comment --edit-last`. That edits the last comment written by the token's user, which is `github-actions[bot]` for every workflow in the repository. If another bot commented after evalgate, the next run overwrote that comment instead. The `<!-- evalgate -->` marker that `report.ts` writes at the top of every comment was never used to find the right one.

## Decision
A new command, `evalgate comment --repo owner/name --pr N --body-file f`, lists the comments on the pull request (100 per page) and picks the newest one whose body starts with the marker. It edits that comment with `PATCH`, or creates one with `POST` when none exists. It uses the REST API with plain `fetch` and `GITHUB_TOKEN`, so the `gh` CLI is no longer needed. The fetch is injected, so the logic is unit-tested without a network.

HTTP errors and a missing token exit with code 2. The action step turns that into a `::warning::` and exits 0, so a read-only token on a fork PR never fails the job. The gate result does not depend on the comment.

## Consequences
- The comment is created once and then edited in place; other bots' comments are never touched.
- Works against GitHub Enterprise through `--api-url` or `GITHUB_API_URL`.

## What I gave up
- One extra list call per run, and a cap of 30 pages (3000 comments); past that a new comment is created instead.
- `gh`'s retry and auth handling. The command has no retries; a transient failure becomes a warning.
