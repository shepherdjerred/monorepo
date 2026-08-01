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
