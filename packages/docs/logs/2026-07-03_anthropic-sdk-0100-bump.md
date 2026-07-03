---
date: 2026-07-03
slug: anthropic-sdk-0100-bump
pr: "1368"
---

# PR #1368: @anthropic-ai/sdk bump to v0.100.1

## Status

In Progress

## Context

Renovate PR to bump `@anthropic-ai/sdk` from `^0.96.0` to `^0.100.1` across
`packages/temporal`, `packages/llm-observability`, and `packages/monarch`.

## Issues Found and Fixed

### 1. `bun.lock` drift in `discord-plays-pokemon` and `scout-for-lol`

Both packages depend on `llm-observability` via `file:` links. The SDK bump in
`llm-observability` caused their per-package lockfiles to drift (the reverse
`file:`-dep closure). The `bun-lock-drift-check` CI gate caught this.

Fix: regenerated both lockfiles with `bun install` and committed.

- `packages/discord-plays-pokemon/bun.lock`
- `packages/scout-for-lol/bun.lock`

### 2. `Usage.output_tokens_details` required field in SDK v0.100.1

`@anthropic-ai/sdk` v0.100.1 added `output_tokens_details: OutputTokensDetails | null`
as a required field on the `Usage` interface. The test stub in
`packages/temporal/src/activities/pr-review/summary.test.ts` was missing it,
causing a TypeScript error.

Fix: added `output_tokens_details: null` to the stub object.

### 3. `discord-plays-pokemon` EEXIST bun-install race condition (build #4837)

Three parallel Dagger containers (lint, typecheck, test) all tried to create the same
symlink `@shepherdjerred/eslint-config@../eslint-config` in the shared BUN_CACHE
mutable volume simultaneously. The 3-attempt retry in `BUN_INSTALL_WITH_RETRY` was
insufficient — all 3 attempts ran before the cache was warm.

Fix: manually retried the `pkg-check-discord-plays-pokemon` Buildkite job via API.
The retry succeeded in ~1 minute (cache was warm from the first attempt).

Note: Buildkite RETRY config has `{ exit_status: 1, limit: 0 }` so there is NO
automatic retry for this error class.

### 4. Greptile excluded-author skip (build #4837)

Greptile posted `<!-- greptile-status -->` + "PR author is in the excluded authors
list." on PR #1368 (because `claude@sjer.red` is excluded). `parseGreptileSkippedReview`
in `scripts/ci/src/wait-for-greptile.ts` returned `null` for this unrecognized body,
causing the gate to poll for 1200s then throw a timeout error — greptile-review would
have FAILED, causing quality-gate FAIL and CI Complete FAIL.

Fix: added `"excluded-author"` as a third `GreptileSkipReason` with detection and
message. All 58 tests pass (main had independently added 3 new tests for this case).
Commit `961436a25`.

### 5. Merge conflict with origin/main (post-push)

When commit `961436a25` was pushed, `ci/merge-conflict` failed because main had
independently added the same excluded-author skip reason in `wait-for-greptile.ts`
(via PR #1366 / commit `937886a74`). The conflict was only in the JSDoc comment
describing the third skip case.

Fix: merged origin/main, resolved conflict by taking main's more informative JSDoc
wording (hyphenated "excluded-authors", "observed phrase" qualifier, note about
Renovate bot PRs). All 58 tests passed. Merge commit `c7eed1df2`. Build #4857 running.

## Session Log — 2026-07-03

### Done

- Diagnosed `bun-lock-drift-check` CI failure: `discord-plays-pokemon` and `scout-for-lol` bun.lock files were stale
- Regenerated `packages/discord-plays-pokemon/bun.lock` and `packages/scout-for-lol/bun.lock`
- Commit `88eed2b63`: lockfile fix
- Diagnosed TypeScript error: `output_tokens_details` missing from `Usage` stub in `summary.test.ts`
- Fixed `packages/temporal/src/activities/pr-review/summary.test.ts:47` to add `output_tokens_details: null`
- Commit `e1e984b39`: typecheck fix
- Detected and fixed Greptile excluded-author timeout (new unhandled skip reason in `wait-for-greptile.ts`)
- Commit `961436a25`: greptile excluded-author fix
- Manually retried `pkg-check-discord-plays-pokemon` after EEXIST bun-install flake (build #4837)
- Resolved merge conflict with origin/main in `scripts/ci/src/wait-for-greptile.ts`
- Merge commit `c7eed1df2`
- Build #4857 started with all 63 dynamic jobs reserved

### Remaining

- Monitor build #4857 for all HARD checks to pass
- If `discord-plays-pokemon` EEXIST flake recurs, retry via Buildkite API

### Caveats

- Renovate will no longer auto-rebase since a non-Renovate author made commits. This is expected.
- `@anthropic-ai/sdk/resources/messages` is now a directory in v0.100.1 (previously a flat file). The existing import paths still work.
- The EEXIST bun-install race is a known pre-existing issue documented in `.dagger/src/base.ts`. It flakes when BUN_CACHE is cold and parallel containers race on the same symlink.
- CI priority: build #4857 is the newest active build and thus has the lowest priority in the FIFO system. Expect some queue delay before K8s jobs start.
