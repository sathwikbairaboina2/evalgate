## 2026-10-03 — Claude (Sonnet builder) — branch main

- Changed: Tasks 1-14 done, one commit per task. Toolchain and stats core, scorers, config loader, judge, targets, runner, compare gate, PR comment renderer, calibration, toy agent examples, CLI, composite action and workflows, Docker, README/LICENSE/live calibration. Also added `.gitattributes` (`* text=auto eol=lf`) so `scripts/docker-example.sh` stays LF.
- Verified: `pnpm typecheck` (clean), `pnpm test` (Test Files 11 passed (11), Tests 112 passed (112)), `pnpm build`, CLI smoke (compare exit 1 on regressed, 0 on identical), Docker (`docker compose run --rm test` 11 files / 112 tests passed; `docker compose run --rm example` exit 1 as expected), YAML parse of action + workflows.
- Measured: toy agent base 1.000 vs regressed 0.500, p = 0.0313; judge kappa 1.000 (qwen3.8:27b, 16 items, 156.8 s, run in Docker).
- Left: v0.2 ideas (cached baselines behind a flag, graded scales, multi-rater kappa, Marketplace release with committed dist/), actionlint (not run: not installed). The action and workflows have not been exercised on GitHub.
- How to verify: `pnpm install && pnpm check`; `docker compose run --rm test`; `docker compose run --rm example` (expects exit 1).

## 2026-10-03 — Claude (Opus reviewer) — branch main

- Review: re-ran `pnpm typecheck` (clean), `pnpm test` (11 files, 112 tests passed), `pnpm build`, and the CLI smoke test (base 1.000, regressed 0.500, compare exit 1). Checked the README's numbers against `docs/calibration/2026-10-03-qwen3.8-27b.json` (kappa 1, 156.8 s). No fix rounds were needed.
- Caveat: during the build, the TDD red step was only observed for Task 1; for Tasks 2-14 the tests were written with the code from the plan.
- Left: run the action on a real GitHub PR, actionlint, a larger multi-rater labelled set (kappa 1.000 on 16 easy items is weak evidence).

- Ruling: builder commits e87e213..9e962fe carry the `Co-Authored-By: Claude Sonnet 5.5` trailer, not Opus 5.5, because Sonnet wrote the code and the trailer should attribute accurately. History is not rewritten.

## 2026-10-04 — Claude (Opus lead) — branch main

- Changed: verified the review fix for the stale base worktree. With the `git worktree remove`/`git worktree prune` pre-clean in `scripts/action/evaluate-base.sh` temporarily removed, both new e2e cases fail (`2 failed | 3 passed`); with it restored, all pass. Rewrote `docs/DEVDOCS.md` as a short developer guide. Updated the README test count to 139.
- Verified (2026-10-04): `pnpm typecheck` clean; `pnpm test` 13 files / 139 tests passed; `pnpm build` ok; `pnpm lint:actions` actionlint ok, shellcheck ok; `docker compose build` then `docker compose run --rm test` 13 files / 139 tests passed; `docker compose run --rm example` exit 1; `docker compose down`, no `evalgate` containers left; CLI smoke base 1.000, regressed 0.500, p = 0.0313, compare exit 1.
- Left for the user: push and run the action on a real GitHub PR (including a read-only fork token); a harder, multi-rater calibration set (`docs/calibration/README.md`); release (tag, committed `dist/`, Marketplace, npm); any paid-API judge run.
- How to verify: `pnpm install && pnpm typecheck && pnpm test && pnpm build && pnpm lint:actions`; `docker compose build && docker compose run --rm test && docker compose run --rm example` (expects exit 1).
