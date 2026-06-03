---
id: helm-types-publish-success
status: waiting-on-verification
origin: packages/docs/logs/2026-05-21_helm-types-publish-pkg-path-fix.md
source_marker: false
---

# Confirm `@shepherdjerred/helm-types (dev)` publishes green on next main build

## What

Build #2635 (and #2622 / #2630 / #2632) failed `:npm: Publish @shepherdjerred/helm-types (dev)` with `ENOENT: failed opening cache/package/version dir for package @shepherdjerred/eslint-config`. Root cause was a mount-path / `file:`-ref-path mismatch for scoped/nested npm packages in `publishNpmHelper`. Fixed in commit `e553d82ec` by adding an explicit `pkgPath` arg through `publishNpmHelper` → `publishNpm` → CI step generator. Local `dagger call ... --dryrun` passes end-to-end for both helm-types (scoped) and webring (unscoped). The next main build needs to confirm publish goes green against the real npm registry.

## Why it's open

Last main build at session close did not yet contain the fix. Acceptance is "watch the next main build" and verify the step succeeds end-to-end, not just in dryrun.

## Done when

- A main build with commit `e553d82ec` (or descendant) runs and the `:npm: Publish @shepherdjerred/helm-types (dev)` step passes.
- The npm registry shows a new `@shepherdjerred/helm-types` dev tag from that build.
- If it fails again, regression test in `scripts/ci/src/__tests__/pipeline-builder.test.ts` should be extended; failure mode is captured in a new log.

## References

- Originating log: `packages/docs/logs/2026-05-21_helm-types-publish-pkg-path-fix.md`
- Fix commit: `e553d82ec`
- Failing builds for context: [#2635](https://buildkite.com/sjerred/monorepo/builds/2635), #2622, #2630, #2632
- Touched paths: `.dagger/src/release.ts:232`, `.dagger/src/index.ts:901`, `scripts/ci/src/steps/npm.ts:33`
