---
id: plan-2026-07-28-deterministic-bindery-image-identity
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Stop repeated Bindery image-version bumps

## Summary

Bindery compiles each Buildkite build number and monorepo SHA into `/bindery`.
That changes its final rootfs layer on every main build, so the existing layer
comparator repeatedly requests another digest bump.

Fix Bindery specifically, retain the existing repository-wide rootfs
comparator, and add regression guards preventing dynamic build identity from
returning.

## Implementation

- Close generated PR #1772 as metadata-only churn.
- Remove Bindery's `VERSION` and `COMMIT` mappings from `docker-bake.hcl`.
- Embed a deterministic runtime identity:
  - `version`: `sha-<upstream SHA first 12>-patch-<patch SHA-256 first 12>`
  - `commit`: the complete `BINDERY_SOURCE_REF`
  - `date`: empty
- Require the Bindery smoke stage to observe the expected version and commit in
  its startup log.
- Extend the image-migration validator and tests to reject dynamic Bindery
  build stamps.

## Interfaces

There are no API schema, Kubernetes manifest, or TypeScript type changes.
Bindery's existing `/system/status` fields change semantics:

- `version` identifies upstream source plus the local patch.
- `commit` identifies the complete upstream commit.
- `buildDate` is empty and hidden by the UI.

Registry tags, immutable pins, image selection, and generic rootfs comparison
remain unchanged.

## Verification

- Run the Bindery Buildx smoke target.
- Run focused validator tests and root-scripts typecheck, lint, and tests.
- Run pipeline validation, staged pre-commit checks, and the complete local
  `bun run verify` because verification machinery changes.
- Require the PR's Buildkite `verify` and `images-pr` lanes to pass.
- After merge, allow one legitimate Bindery digest bump, then require the next
  eligible main build to report Bindery as `content-unchanged`.
- Verify ArgoCD application `media`, deployment `bindery`, and the runtime
  startup identity after reconciliation.

## Remaining

- [x] Implement deterministic Bindery identity.
- [x] Add and run focused regression verification.
- [x] Run the complete repository verification.
- [x] Publish the git-spice PR and validate its executable Buildkite lanes.
- [ ] Merge the PR and verify the generated pin bump, second-build stability,
      and live rollout.

## Comment Log

- 2026-07-28: Approved focused Bindery fix with a durable guard. Selected
  source-plus-patch identity and closure of generated PR #1772.
- 2026-07-28: Implemented source-plus-patch identity, exact startup-log smoke
  assertions, and validator coverage rejecting dynamic Bake or linker identity.
  Two production-target builds with distinct `VERSION` and `GIT_SHA` inputs
  produced identical 13-layer root filesystems.
- 2026-07-28: Full `bun run verify` passed all 217 tasks. Draft PR #1775
  contains the implementation and verification evidence.
- 2026-07-28: Buildkite build #6756 passed every executable PR lane, including
  `verify` and the image build/smoke dry-run. Its Codex review gate recorded
  zero findings but timed out waiting for a provider completion signal.
  `origin/main` then advanced to `d457fbba40b6`, so the branch will be restacked
  and the replacement current-head build will be authoritative.

## Session Log — 2026-07-28

### Done

- Traced repeated pin PRs to dynamic Buildkite identity compiled into Bindery's
  final rootfs layer.
- Confirmed other stamped images keep identity in image configuration rather
  than filesystem layers.
- Closed PR #1772 with a root-cause explanation.
- Removed Buildkite build identity from the Bindery Bake target and binary.
- Added validator regression coverage and an exact runtime identity smoke
  assertion.
- Passed focused validator, root-scripts typecheck/lint/test, pipeline, TODO,
  Buildx smoke, and two-build rootfs reproducibility checks.
- Passed the complete local `bun run verify` graph: 217 of 217 tasks.
- Published draft PR #1775 through git-spice.

### Remaining

- Merge PR #1775 after its required current-head checks are green.
- After human merge, verify the one-time pin bump, second-main-build stability,
  and live ArgoCD rollout.

### Caveats

- The first main build after the fix should create one legitimate Bindery pin
  bump because the embedded identity changes once.
- Post-merge verification cannot begin until the implementation PR is merged.
- Buildkite #6756's only failure was the Codex provider timeout after all
  executable lanes passed with zero review findings; it is superseded by the
  restacked head.
- The broader image-configuration comparison question remains unchanged.
