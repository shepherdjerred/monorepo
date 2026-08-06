---
id: scout-release-orphan-atomic-archive
type: todo
status: planned
board: true
verification: agent
disposition: blocked
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
`2026-08-02_main-ci-green-session.md`),
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

1. **Atomic write** — commit the flavor archive record(s) and the
   `inputs/<digest>.json` pointer as a single logical unit that can never
   leave the pointer visible without its archives. **Keep the existing
   archive-then-input order** — do not flip it. Writing `inputs/<digest>.json`
   before its archives exist would open a _worse_ orphan class: `prepareState`
   treats a present input record as "already built" and returns early without
   rebuilding `.scout-release/{prod,beta}`
   (`scripts/scout-site-release.ts:203-214`), so a subsequent `archiveFlavor`
   call would fail at `assertStaticSiteComplete`
   (`scripts/lib/scout-site-storage.ts:285-299`) validating a local source
   directory that was never produced — a silent "release is done" pointer with
   no reachable site behind it. Concretely: only ever write
   `inputs/<digest>.json` after both flavor archives are confirmed present.

   This must also handle the **partial-archive case that actually occurred**:
   build #7794 was canceled immediately after `prod.json` committed but before
   `beta.json` or the input record, so `beta.json` never existed for that
   digest. A retry that only resumes when _both_ flavor records already exist
   does not recover this case — it still rebuilds `prod` under the new
   `sourceCommit`, colliding with the immutable, already-archived `prod.json`
   from the old commit, and there is no local `beta` archive to adopt in its
   place. Any incomplete identity (one flavor archived, no input pointer) must
   be handled explicitly, e.g.:
   - **Delete-and-rebuild** — since no `inputs/<digest>.json` references this
     identity, nothing depends on the lone `prod.json` being preserved; delete
     it (and any other partial flavor records for that identity) before doing
     a full fresh build under the current commit, then archive both flavors
     and write the input pointer as normal. This mirrors the manual cleanup
     already performed for build #7794's orphan. **This is only safe before
     `archiveScout` reaches the `versions/<version>.json` write
     (`scripts/lib/scout-site-storage.ts:338`)** — see the version-linked case
     below for why deletion is unsafe once that record exists.
   - **Rebuild at the recorded commit** — alternatively, check out the
     `sourceCommit` recorded in the existing `prod.json` in a scratch clone,
     rebuild `beta` there so its digest matches what a same-commit build would
     have produced, then archive `beta` and write the input pointer. More
     complex than delete-and-rebuild; only worth it if losing the already-spent
     `prod` build time matters.

   **Version-linked cancellation is a separate, narrower case that
   delete-and-rebuild must not touch.** `archiveScout` (lines 327-345) only
   reaches the `versions/<version>.json` write (line 338) _after_ **both**
   `archiveFlavor("prod", …)` and `archiveFlavor("beta", …)` have already
   succeeded — so by the time that record exists, both flavor archives are
   already complete and mutually consistent (produced from the same in-memory
   `state`). A cancellation in the narrow window after line 338 but before the
   `inputs/<digest>.json` write (lines 340-344) therefore never has a partial
   (single-flavor) archive — it always has a complete, matching pair, plus an
   immutable `versions/<version>.json` that already pins those exact digests.
   Deleting and rebuilding under a new commit here would silently invalidate
   that version record (later reads/deploys of that version number would find
   digests that no longer match anything in S3). The only safe recovery once
   `versions/<version>.json` exists is to **reuse the existing archives
   verbatim** — read them back, confirm they still match the version record,
   and finish only the missing `inputs/<digest>.json` write; never delete or
   rebuild in this case. Any implementation must check for
   `versions/<version>.json` first and route to this reuse-only path before
   ever considering deletion.

2. **Reconcile on read** — have `archiveFlavor`, on finding an existing
   `<digest>/<flavor>.json` with no matching `inputs/<digest>.json`, treat it
   as an orphan and adopt its recorded content (rather than a freshly
   recomputed state) to finish writing `inputs/<digest>.json`, instead of
   failing closed on a digest mismatch. This loosens the current
   `--if-none-match "*"` immutability guarantee only for the read path, not the
   write path (the archive bytes themselves are never overwritten).

   This still needs the same partial-archive handling as approach 1: adopting
   `prod.json`'s recorded state fixes what `beta`'s digest is _supposed_ to
   be, but `beta`'s bytes were never uploaded, so `beta` must still be rebuilt
   to match that adopted digest — which only happens if it's rebuilt at the
   adopted `sourceCommit` (see "rebuild at the recorded commit" above), not the
   current checkout's commit. If rebuilding at an old commit isn't worth the
   complexity, reconciliation should fall back to delete-and-rebuild for that
   identity rather than silently adopting a state it can't actually complete.

## Remaining

- [ ] Get explicit owner sign-off on approach 1, approach 2, or "keep manual
      cleanup" before implementing.
- [ ] If approved, implement the chosen fix in `scout-site-storage.ts` /
      `scout-release-state.ts` / `scout-site-release.ts`.
- [ ] Add regression tests reproducing all three cancel-between-writes shapes:
      (1) only one flavor archived, no `versions/<version>.json`, no input
      record (matching the actual #7794 incident) — assert delete-and-rebuild
      or rebuild-at-recorded-commit; (2) both flavors archived but no
      `versions/<version>.json` yet — safe to delete-and-rebuild or reuse; and
      (3) both flavors archived **and** `versions/<version>.json` already
      written, only the input record missing — assert the recovery reuses the
      existing archives verbatim and never deletes/rebuilds.
- [ ] If "keep manual cleanup" is chosen instead, document the cleanup runbook
      (verify true orphan: no input record, not in `versions/`, not the prod
      pin, then delete only that identity prefix) here or in `guides/` and
      close this todo as won't-fix.

## Comment Log

- 2026-08-02 — Filed from PR #1966 review feedback (chatgpt-codex-connector,
  P2) after the 2026-08-02 main-CI-green session cleared one live orphan
  operationally but left no durable fix or tracked follow-up.
- 2026-08-03 — Corrected an unsafe input-first ordering in approach 1
  (chatgpt-codex-connector, P2).
- 2026-08-03 — Extended both approaches to explicitly cover the
  partial-archive case (only `prod.json` written, matching the actual #7794
  incident), which the prior revision's "resume when both flavors exist"
  wording did not recover (chatgpt-codex-connector, P2).
- 2026-08-03 — Split the "both flavors archived" recovery further: once
  `versions/<version>.json` is also written (which — per `archiveScout`'s
  order — only happens after both flavors are already complete and mutually
  consistent), delete-and-rebuild would invalidate that immutable version
  record; the only safe recovery there is reuse-existing-archives-verbatim,
  never delete/rebuild (chatgpt-codex-connector, P2).
