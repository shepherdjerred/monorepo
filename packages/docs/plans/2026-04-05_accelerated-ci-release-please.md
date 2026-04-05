# Accelerated CI for Release-Please and Version Commit-Back PRs

**Date:** 2026-04-05
**Status:** Not Started

## Problem

PRs created by release-please (version bumps, CHANGELOGs) and version-commit-back (image digest updates in versions.ts) go through the full CI pipeline including all quality gates, per-package lint/typecheck/test, etc. This is wasteful — the underlying code was already validated in the commit that triggered these automated PRs.

## Proposal

Detect PRs that ONLY touch release/version files and skip quality gates, going straight to the release/deploy phase.

### Detection

In `scripts/ci/src/change-detection.ts`, if ALL changed files match these patterns:

- `CHANGELOG.md`
- `.release-please-manifest.json`
- `package.json` (only in release-please-managed package paths: `packages/clauderon`, `packages/astro-opengraph-images`, `packages/webring`, `packages/homelab/src/helm-types`)
- `Cargo.toml`, `Cargo.lock` (clauderon uses Rust release-type)
- `packages/homelab/src/cdk8s/src/versions.ts`

→ set `affected.accelerated = true`

### Pipeline Changes

In `scripts/ci/src/pipeline-builder.ts`, when `accelerated`:

- Skip all blocking quality gates (lint, typecheck, test, shellcheck, compliance, gitleaks, etc.)
- Skip per-package build groups
- Emit quality-gate as a pass-through (so downstream steps can still depend on it)
- Go straight to: release-please, npm publish, helm push, image push, deploy, ArgoCD sync

### Files to Change

- `scripts/ci/src/lib/types.ts` — add `accelerated: boolean` to `AffectedPackages`
- `scripts/ci/src/change-detection.ts` — detect accelerated file pattern
- `scripts/ci/src/pipeline-builder.ts` — skip gates when `accelerated` is true

### Considerations

- Must be conservative — if ANY file outside the pattern list is changed, run full CI
- release-please PRs may also touch `Cargo.toml` for Rust packages
- version-commit-back PRs only touch `versions.ts`
- The accelerated pipeline should still run release-please itself (to ensure the PR is up to date)
