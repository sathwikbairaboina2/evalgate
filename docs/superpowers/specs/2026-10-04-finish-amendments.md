# Evalgate v0.1 spec amendments (2026-10-04)

Amends `2026-10-03-evalgate.md`. Decisions are in ADR-0008 and ADR-0009.

1. **New CLI command**: `evalgate comment --repo owner/name --pr N --body-file f [--api-url url]`. It reads `GITHUB_TOKEN` from the environment, finds the newest comment on the PR whose body starts with `<!-- evalgate -->`, edits it, or creates one. `GITHUB_API_URL` is honoured. A missing token, a bad argument or an HTTP error exits 2. Success prints `evalgate: comment <created|updated>: <url>` to stderr.
2. **New action inputs**: `head-target-url` and `base-target-url` (default empty). For `http` targets they are passed as `--target-url` to the head and base runs, so the two runs can hit different deployments.
3. **Judge parser rule**: the judge reply is scanned for balanced `{...}` objects (braces inside JSON strings are ignored). The first one that parses and has a `verdict` key is used. An object without `verdict`, or an unbalanced one, is never a pass.
4. **Action behaviour**: the step logic lives in `scripts/action/*.sh`. The base worktree is cleaned up before and after each run. A failure to post the comment is a warning, not a failed job.
5. **Acceptance item 5** now also requires `pnpm lint:actions` (actionlint and ShellCheck) to pass, and the action scripts' end-to-end test to pass.
