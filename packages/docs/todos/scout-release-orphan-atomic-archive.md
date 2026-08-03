---
id: scout-release-orphan-atomic-archive
type: todo
status: planned
board: true
verification: agent
disposition: blocked
origin: packages/docs/logs/2026-08-02_main-ci-green-session.md
source_marker: false
---

# Scout release: make flavor-archive + input-record writes atomic (or reconcile orphans)

## Problem

`archiveScout` (`scripts/lib/scout-site-storage.ts`) commits
each flavor's immutable archive record before it commits the input record:

- `archiveFlavor("prod", …)` / `archiveFlavor("beta", …)` in
  `scripts/lib/scout-site-storage.ts` (`archiveFlavor` at lines 276-325,
  `archiveScout` at lines 327-345) each `putImmutableObject` a
  `<releaseInputDigest>/<flavor>.json` record (line 321) using
  `--if-none-match "*"` — permanent once written.
- Only afterward does `archiveScout` write `versions/<version>.json` (line 338)
  and `inputs/<releaseInputDigest>.json` (lines 340-344).

If the Buildkite step is canceled between those writes (the rapid-merge
cancellation pattern documented in
[`2026-08-02_main-ci-green-session.md`](../logs/2026-08-02_main-ci-green-session.md)),
the flavor archive is left orphaned: present in S3 with no matching
`inputs/<digest>.json` pointer.

`prepareState` (`scripts/scout-site-release.ts`, lines 167-240) dedupes via
`readScoutStateByInput` (lines 203-214) — if `inputs/<digest>.json` is
missing it silently rebuilds instead of reusing the existing archive. Because
`buildSite` (lines 116-152) bakes `sourceCommit` into `VITE_GIT_SHA` /
`PUBLIC_GIT_SHA` (lines 133-134), a rebuild with the same `RELEASE_INPUT_PATHS`
selection (same `releaseInputDigest`) but a different `sourceCommit` produces a
different `siteArchiveDigest`. `archiveFlavor`'s existing-record check then
calls `assertArchiveRecordMatchesState`
(`scripts/lib/scout-release-state.ts`, lines 138-153), which compares via
`sameScoutReleaseContent` (lines 110-121) and throws `"immutable ${flavor}
archive record does not match state"` — a hard, permanently-unrecoverable
failure for that digest until someone manually deletes the orphaned prefix
from `s3://scout-site-releases/` (done once, operationally, on 2026-08-02 for
digest `<releaseInputDigest>` under build #7794 — see the origin log).

No comment in `scout-site-storage.ts`, `scout-release-state.ts`, or
`scout-site-release.ts` currently acknowledges this race.

## Why this needs sign-off

Two fix shapes change deliberately fail-closed release semantics and the
repository owner should choose between them (or reject both in favor of
keeping the manual-cleanup runbook):

1. **Atomic write** — write the flavor archive record(s) and the
   `inputs/<digest>.json` pointer as a single logical commit (e.g. write the
   input record first and have `archiveFlavor` require it to already exist,
   or use a two-phase marker) so a cancellation between them can't happen.
2. **Reconcile on read** — have `archiveFlavor`, on finding an existing
   `<digest>/<flavor>.json` with no matching `inputs/<digest>.json`, treat it
   as an orphan and overwrite/reclaim it (loosens the current
   `--if-none-match "*"` immutability guarantee for that narrow case) rather
   than failing closed.

## Remaining

- [ ] Get explicit owner sign-off on approach 1, approach 2, or "keep manual
      cleanup" before implementing.
- [ ] If approved, implement the chosen fix in `scout-site-storage.ts` /
      `scout-release-state.ts` / `scout-site-release.ts`.
- [ ] Add a regression test reproducing the cancel-between-writes race
      (archive written, input record missing) and asserting the new behavior.
- [ ] If "keep manual cleanup" is chosen instead, document the cleanup runbook
      (verify true orphan: no input record, not in `versions/`, not the prod
      pin, then delete only that identity prefix) here or in `guides/` and
      close this todo as won't-fix.

## Comment Log

- 2026-08-02 — Filed from PR #1966 review feedback (chatgpt-codex-connector,
  P2) after the 2026-08-02 main-CI-green session cleared one live orphan
  operationally but left no durable fix or tracked follow-up.
