---
id: log-2026-06-06-streambot-pr1020-ci-followup
type: log
status: complete
board: false
---

# StreamBot PR 1020 CI Follow-up

## Context

PR 1020's Buildkite commit statuses were green at the start of this follow-up, but two unresolved P2 review threads remained on the StreamBot image provenance and cookies-path configuration.

## Session Log — 2026-06-06

### Done

- Confirmed PR 1020 head `c2961148f4d97a87df922c577cc63d383ad7af95` had successful Buildkite commit statuses.
- Verified upstream `ysdragon/StreamBot` publishes its standard Compose image as `quay.io/ydrag0n/streambot:latest`.
- Added an image provenance note to `packages/homelab/src/cdk8s/src/versions.ts`.
- Removed the explicit empty `YTDLP_COOKIES_PATH` env var from `packages/homelab/src/cdk8s/src/resources/streambot.ts`; upstream defaults the missing env var to an empty string before checking it.

### Remaining

- Recheck Buildkite on the new PR 1020 head after GitHub schedules the follow-up build.
- Resolve or reply to the two Greptile P2 review threads once the new commit is visible on GitHub.

### Caveats

- The Quay web UI did not expose useful unauthenticated metadata through `toolkit fetch`; upstream Compose and source files were used as the authoritative evidence.

## Session Log — 2026-06-06 (CI green: stale-branch prettier + flaky temporal test)

A later session was asked to get PR 1020's Buildkite CI fully green. Two distinct failures were found and fixed; the branch was also brought current with `main`.

### Done

- **Prettier failure (build #3276) — stale branch.** The `art-prettier` step runs `prettier --check .` over the whole repo. The branch's merge-base was 37 commits behind `main`, so it still carried pre-reformat copies of `.dagger/src/misc.ts` and `packages/docs/logs/2026-06-03_birza-music-live-patch.md` (both already reformatted on `main`). Root-cause fix: merged `origin/main` into the branch (clean; `versions.ts` auto-merged, streambot pin preserved). Prettier then passed repo-wide.
- **`test-tube-test` failure (build #3353) — flaky Bun `mock.module` leak.** Temporal's `src/activities/agent-task.test.ts` calls `mock.module("#activities/agent-task-command.ts", () => ({ buildAgentTaskCommand }))`, omitting `reportOnlyPrompt`. Bun's `mock.module` is global across test files, so when that file loads before `alert-remediation-command.test.ts` is linked, the latter's `import { reportOnlyPrompt }` resolves to the mock that lacks it → `Export named 'reportOnlyPrompt' not found` (order-dependent ⇒ flaky). This also hit `main` (build #3360 `Test` red); the prior "force CI rebuild" no-op comment in `agent-task-command.ts` did not fix it. Root-cause fix (commit `0c6c00be4`): moved the pure `reportOnlyPrompt` into the never-mocked `#shared/agent-task.ts`, imported it back into `agent-task-command.ts`, and pointed the test at `#shared/agent-task.ts`; removed the leftover `// Force CI rebuild` comment. Verified locally: `bun test` 473 pass / 0 fail, typecheck/eslint/prettier clean.
- Merged latest `origin/main` (through `008222cb5`) again before the fix so the branch is current.
- **Result:** Buildkite build #3367 passed (only `trivy-scan` + `large-file-check` soft-fail, which are ignored). PR is `MERGEABLE` / `CLEAN`. Both Greptile P2 threads (`versions.ts` provenance, `streambot.ts` cookies path) are resolved; the re-review of `0c6c00be4` added no new findings.

### Remaining

- None for CI. The PR is green, mergeable, and free of P3+ review comments.

### Caveats

- The `reportOnlyPrompt` mock-leak fix also benefits `main`, which carried the same flaky `Test` failure; once this PR merges, `main`'s temporal `Test` step should stop flaking.
- `large-file-check` and `trivy-scan` are configured `softFail: true` and report green to GitHub; the `caddyfile-validate` red on `main` #3360 was a transient Dagger engine snapshot error, not a code issue (no caddy files changed).
