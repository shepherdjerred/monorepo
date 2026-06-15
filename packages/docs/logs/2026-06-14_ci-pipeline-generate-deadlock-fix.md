# CI pipeline-generate deadlock — pagination + emergency override

## Status

In Progress

## What broke

Main CI build #4379 (and every prior one in the recent streak) couldn't even
generate its pipeline. `scripts/ci/src/change-detection.ts:511`
(`getLastSuccessfulCommit`) threw:

```
No qualifying successful main build found; cannot scope this build safely
(hard-failed-jobs: 18, incomplete: 81)
```

The function read the most recent 100 main builds from the Buildkite REST API
and tried to find one in `passed` state with clean script jobs. The most
recent actually-passing main build (#3921, 2026-06-13) sat outside that
100-build window after a long streak of cancellations (newer commits
superseding in-flight builds) and a handful of hard failures
(`pkg-check-streambot` was the most recent root cause). With no qualifying
base in the window, the function threw and pipeline generation aborted before
ever running a step.

This is a self-deadlock: every new main commit walked into the same wall, so
main CI couldn't recover on its own.

## Fix

`scripts/ci/src/change-detection.ts` `getLastSuccessfulCommit`:

1. **Pagination** — walk up to `LAST_SUCCESS_MAX_PAGES = 10` pages of 100
   builds (1 000 total) before giving up. Stops early when a page returns
   fewer than `per_page` results (end of history reached).
2. **Emergency override** — honour `LAST_SUCCESSFUL_COMMIT_OVERRIDE`. When
   set, return that SHA immediately and skip the Buildkite API entirely. Lets
   an operator unstick main CI by retriggering one build with the env var set
   (e.g. via the Buildkite UI "New Build" → env vars) — no code change
   required.
3. **Better error** — when pagination is exhausted, the thrown message now
   names the actual number of builds scanned and points at the override env
   var so the next person hitting this knows the escape hatch.

PR-branch builds aren't affected — they use
`getMergeBaseWithOriginMain`, not `getLastSuccessfulCommit`. So this fix
PR's own branch CI passes normally, and the next main build after merge
picks up the fixed code, paginates back, finds #3921 (or older), and
recovers.

## Test coverage added

`scripts/ci/src/__tests__/change-detection.test.ts`:

- Override env var short-circuits — no fetch, no API token, no org/pipeline
  needed.
- Empty override falls through to the API.
- Pagination walks from page 1 to page 2 when page 1 is all rejections, and
  returns the page-2 base.
- Pagination stops early on a short page (no wasted requests).
- Page cap exhausted → descriptive error naming both the scan size and the
  `LAST_SUCCESSFUL_COMMIT_OVERRIDE` escape hatch.

## Verification

- `bun run typecheck` — clean
- `bun test src/__tests__/change-detection.test.ts` — 125 pass, 0 fail
- `bash scripts/check-dagger-hygiene.sh` — no violations

## Session Log — 2026-06-14

### Done

- `scripts/ci/src/change-detection.ts` — pagination + override
- `scripts/ci/src/__tests__/change-detection.test.ts` — five new tests
- `packages/docs/logs/2026-06-14_ci-pipeline-generate-deadlock-fix.md` — this
  log

### Remaining

- Open PR, watch its branch CI pass, merge.
- After merge, watch the first main build under the fixed code to confirm it
  paginates and finds a real base. If it still can't, fall back to the
  `LAST_SUCCESSFUL_COMMIT_OVERRIDE` knob with an older main SHA (e.g.
  `a3c670b48b` from passing build #3921) on a retriggered build.
- Investigate the underlying `pkg-check-streambot` failure that helped get us
  into this state. PR #1245 (`harden streambot test`) claims to address it
  but its main build (#4378) was canceled before it could prove out.

### Caveats

- `LAST_SUCCESS_MAX_PAGES = 10` is a hard cap. If main is ever broken for
  more than ~1 000 main commits (unlikely on this repo), we'll still
  deadlock — but the error now explicitly tells the next reader to use the
  override.
- The 10-page worst case is 10 sequential Buildkite REST calls. That's slow
  but only kicks in during recovery. Normal main builds hit a hit on page 1
  and short-circuit.
