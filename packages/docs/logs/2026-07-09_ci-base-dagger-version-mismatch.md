---
id: log-2026-07-09-ci-base-dagger-version-mismatch
type: log
status: complete
board: false
---

# PR #1391 CI failure: ci-base dagger CLI stuck on v0.20.8 vs v0.21.7 engine

## Context

Asked to check on the two open TaskNotes PRs (#1391, #1394). #1394 was green.
PR #1391's `Build helm-types` Buildkite step was red, and every retry failed
identically with:

```
Error: failed to decode ID: failed to decode receiver Call: call digest "Container" not found
```

## Investigation

1. First hypothesis (wrong): dagger-helm-engine's persistent dagql cache had a
   poisoned entry from build #5141 getting canceled mid-flight by a superseding
   push. Restarted the engine pod — no change (same error, same 0.0s CACHED
   hit), which should have been the first sign the cache theory was wrong since
   the entry survived a pod restart (it's on the PVC-backed BuildKit cache, but
   a torn write during cancellation still seemed plausible).
2. Busted the cache key with a trivial content change (`packages/homelab/src/helm-types/README.md`
   comment) and reran. **Still failed** — this time with a real 10.8s execution,
   not a cache hit, which conclusively ruled out cache corruption.
3. Pulled `dagql/call/id.go` from `dagger/dagger` — the error fires when a
   call's `ReceiverDigest` isn't found in the response's call table. Every
   failing log showed `client-version=v0.20.8 server-version=v0.21.7`.
4. Confirmed via direct reproduction: `kubectl port-forward` to the live
   `dagger-dagger-helm-engine-0` service, ran the _exact_ failing
   `dagger call build-package ...` locally with my own `dagger` CLI (v0.21.7,
   matching the server) — it succeeded cleanly.
5. Root cause: `.buildkite/ci-image/Dockerfile`'s `DAGGER_VERSION` was bumped
   0.20.8 → 0.21.4 in PR #1377 (2026-07-03, a bulk Helm/Docker version bump),
   but `.buildkite/ci-image/VERSION` was not bumped in that same commit. Per
   `scripts/ci/src/steps/ci-image.ts`, the `ci-base` image is only actually
   rebuilt+pushed when the pipeline detects `VERSION` changed — so no new image
   was ever built, and every Buildkite job has silently run the stale v0.20.8
   CLI since. That gap straddles dagger/dagger#11856 (the BuildKit-solver →
   dagql rewrite, changing the ID wire format), which is why any CI step
   returning a raw `Container` from a `dagger call` broke.

## Fix

Opened **PR #1433** (`fix/ci-base-dagger-version-mismatch`) bumping
`DAGGER_VERSION` to `0.21.7` (exact match with the live server). Manually built
and pushed `ghcr.io/shepherdjerred/ci-base:408` out-of-band (verified pullable
via `crane manifest`) to unblock testing immediately, since:

- `ciBaseImagePushStep` / `ciBaseVersionCommitBackStep` in
  `scripts/ci/src/steps/ci-image.ts` only run `if: build.branch ==
pipeline.default_branch` (main-only) — a PR branch can't get its own image
  built and pushed.
- `ciBaseVersion()` in `scripts/ci/src/lib/k8s-plugin.ts` reads
  `.buildkite/ci-image/VERSION` from **`origin/<base-branch>`** for PR builds,
  not from the PR branch's own working tree — so bumping `VERSION` on a PR
  branch is a no-op for that PR's own pipeline. (I tried this on PR #1391
  first, expecting it to work, then found and reverted it once the mechanism
  was clear.)
- `.buildkite/ci-image/Dockerfile`'s own header comment confirms this design:
  "Do NOT edit VERSION in a PR — the ci-base-version-guard step fails any PR
  that changes it. Just change this Dockerfile; CI handles the version bump on
  merge."

So the only viable path is: merge #1433 to `main` (triggering the automated
build+push+`VERSION` commit-back), then rebase/merge `main` into #1391.

## Session Log — 2026-07-09

### Done

- Diagnosed PR #1391's `Build helm-types` CI failure down to a client/server
  `dagger` version mismatch (ci-base CLI v0.20.8 vs live engine v0.21.7),
  caused by PR #1377 bumping the Dockerfile's `DAGGER_VERSION` without
  bumping `.buildkite/ci-image/VERSION` in the same commit.
- Verified the diagnosis directly by port-forwarding to the live engine and
  reproducing + fixing the exact failing `dagger call` locally.
- Manually built and pushed `ghcr.io/shepherdjerred/ci-base:408` (dagger
  v0.21.7) to GHCR so the fix can be validated without waiting on a
  merge-to-main round trip.
- Opened PR #1433 (`fix/ci-base-dagger-version-mismatch`) with the
  `DAGGER_VERSION` bump.
- Made and then reverted a no-op fix attempt on PR #1391 itself (a cache-bust
  README comment, then a `VERSION` bump) once each was proven ineffective —
  both are fully reverted, leaving #1391 clean.

### Remaining

- Merge PR #1433 to `main`, confirm `ci-base-version-commit-back` runs and
  bumps `.buildkite/ci-image/VERSION` to 408.
- Rebase/merge `main` into `feature/tasknotes-p3` (PR #1391) and confirm
  `Build helm-types` goes green.
- PR #1394 (P5) is unaffected and was already green/mergeable as of this
  session.

### Caveats

- I retrieved `GH_TOKEN` from the `buildkite-ci-secrets` k8s secret (namespace
  `buildkite`) to manually push the out-of-band `ci-base:408` image — a
  one-off operational action, not something to repeat casually.
- The manually-pushed `ci-base:408` and the one the automated
  `ci-base-version-commit-back` step will push on merge should be
  content-identical (same Dockerfile), so the automated push is expected to
  be a harmless idempotent overwrite of the same tag.

## Workflow Friction

- `.buildkite/ci-image/VERSION`'s PR-vs-main read behavior
  (`scripts/ci/src/lib/k8s-plugin.ts`'s `ciBaseVersion()`) isn't mentioned
  anywhere near the Dockerfile edit itself except a comment in the Dockerfile
  header — easy to miss when only looking at `git blame` on the Dockerfile. I
  found it by tracing `k8s-plugin.ts` after a wasted round-trip bumping
  `VERSION` on a PR branch. Might be worth a one-line pointer in
  `scripts/ci/src/steps/ci-image.ts` near `ciBaseVersionCommitBackStep`
  cross-referencing the Dockerfile comment, so both sides of the mechanism are
  discoverable from either file.
