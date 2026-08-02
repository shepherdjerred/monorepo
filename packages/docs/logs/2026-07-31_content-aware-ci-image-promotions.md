---
id: log-2026-07-31-content-aware-ci-image-promotions
type: log
status: complete
board: false
---

# Content-aware CI image promotions

## Summary

Add a second, runtime-content identity check after CI image candidates build.
Candidate builds remain enabled for CI-related source changes, but the promotion
workflow must not open a digest-pin pull request when the candidate has the
same effective runtime image as the current immutable pin.

## Session Log — 2026-07-31

### Done

- Created the implementation worktree and prepared the Bun toolchain.
- Confirmed that application image promotions already use a normalized runtime
  fingerprint that captures rootfs and runtime configuration.
- Reused that oracle for `ci-base` and `ci-playwright` pin promotions.
- Suppressed pin PR creation when a candidate has an identical runtime image;
  preserve promotion when runtime content changes or the existing pin cannot
  be resolved, and fail when the candidate cannot be fingerprinted.
- Added focused coverage for all runtime-promotion outcomes.
- Verified with focused Bun tests, root-scripts lint/typecheck, Prettier, and
  `bun run check-todos`.

### Remaining

- Buildkite build #7519 must validate the real registry inspection path on
  draft PR #1887.

### Caveats

- Candidate-build selection intentionally remains broad; this session changes
  promotion eligibility, not whether CI-related changes may rebuild images.
- A missing current pin is reported and replaced with the verified candidate;
  a missing candidate fingerprint remains a hard failure.
- Draft PR: https://github.com/shepherdjerred/monorepo/pull/1887
- Hosted CI was pending at handoff: https://buildkite.com/sjerred/monorepo/builds/7519

## Session Log — 2026-08-01

Addressed the two Codex review findings that were failing the
`robot-face-review-gate` on PR #1887 (verify already green).

### Done

- **P1 — retire stale promotions before skipping** (`update-ci-image-pin.ts`):
  when the runtime outcome is `content-unchanged`, the build now closes any
  still-open pin PR on the pending branch and deletes that branch before
  returning. Previously the early return left an auto-merge-enabled PR that
  could later land a superseded digest even though the build decided no
  promotion was warranted. Added `retireStalePromotion`; gated on an existing
  pending branch.
- **P2 — CI-specific runtime identity** (`application-image-runtime.ts`): made
  the ignored-`Env` prefixes configurable. Application images keep stripping the
  disposable `VERSION=`/`GIT_SHA=` bake identities (new
  `APPLICATION_IGNORED_ENV_PREFIXES` default); CI images now strip nothing
  (`CI_IMAGE_IGNORED_ENV_PREFIXES = []`) so a CI Dockerfile `ENV VERSION=`/
  `GIT_SHA=` change is no longer misclassified as `content-unchanged`. The CI
  reader in `update-ci-image-pin.ts` passes the CI prefix set.
- Added regression tests: CI-vs-application env normalization in
  `bake-images.test.ts`, and a structural guard in `update-ci-image-pin.test.ts`
  that the content-unchanged path retires the stale PR.
- Verified: focused Bun tests (44 pass), `.buildkite` typecheck, root-scripts
  buildkite lint, Prettier — all clean.

### Remaining

- A fresh Codex review runs on the new head; the gate goes green once it
  re-reviews and finds the findings resolved (prior review latency was ~2h).

### Caveats

- The `promote` orchestrator remains integration-style (real `git`/`gh`); its
  new retire path is covered by a source-structure assertion, consistent with
  the existing lockfile-ordering test in the same file.
