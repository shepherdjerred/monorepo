---
id: plan-2026-08-11-ci-green-cleanup
type: plan
status: in-progress
board: false
---

# CI green cleanup

## Summary

Main is green after several release-path repairs, but the recovery work left
coupling and operator hazards that should not become permanent architecture.
This cleanup restores ordinary ArgoCD sync behavior, makes the root release
workflow smaller, and gives non-CDK8s release consumers a dedicated version
catalog boundary.

## Decisions

- Use Kubernetes 1.36 admission policies to preserve each managed child
  Application's declared sync options during manual operations and to enforce
  the Application deletion contract. Exclude the recursive `apps` root from
  operation mutation.
- Make root sync waves express controller and custom-resource dependencies.
  Child Application health remains authoritative; only the recursive root
  ignores Application health to avoid self-deadlock.
- Evaluate custom Application health with ArgoCD's executable Lua test command.
  Current `Synced` and `Healthy` state wins over a stale failed operation, while
  active operations and unresolved terminal failures stay visible.
- Replace the split root release command sequence with one identity-bound
  `release-root` command and retain one bounded `sync-managed` primitive for
  internal sequencing and recovery.
- Extract the structured version catalog, JSON Schema, parser, and serializer
  into `@shepherdjerred/version-catalog`. Root release scripts and CDK8s consume
  that workspace through `workspace:*`; CDK8s alone owns its generated runtime
  version-map validation.
- Remove CDK8s from release-lane install filters when the only dependency is the
  version catalog. Keep quality gates intact and fail fast on missing tools or
  invalid data.
- Make immutable-field and mutually-exclusive-handler risks visible in a
  read-only preflight before an Argo operation is submitted.

## Implementation

1. Add managed-Application labels, deterministic sync waves, mutating admission
   for operation sync-option merging, and validating admission for lifecycle
   deletion safety.
2. Correct Application Lua health semantics and execute fixture coverage with
   `argocd admin settings resource-overrides health`.
3. Add the apply-safety preflight and consolidate root release orchestration
   behind `release-root apps <expected.json>`.
4. Update Buildkite wiring and its structural validator to require the single
   release command.
5. Create the version-catalog workspace, update all consumers and generators,
   and narrow production install filters.
6. Update operator documentation, the human wiki, repository instructions, and
   skill sources that still describe the reactionary state.

## Verification

- Run focused CDK8s synthesis, tests, typecheck, and lint.
- Run root-script and Buildkite pipeline validator tests, typecheck, and lint.
- Run version-catalog parser, serializer, schema, and consumer coverage.
- Run docs checks and the wiki typecheck, tests, build, and end-to-end tests.
- Run staged lefthook checks and the complete `bun run verify` graph because
  this change modifies verification and release machinery.
- Require an exact-head PR build, merge, and then a fresh successful Buildkite
  build for the current remote `main` SHA before live rollout acceptance.
- After merge, verify the admission policies are established, run a normal
  global root sync, and prove ArgoCD, child Applications, and workloads are
  healthy without immutable-field failures or hidden child health.

## Remaining

- [x] Implement and verify the source, pipeline, and documentation cleanup.
- [ ] Merge the exact validated PR head and obtain a fresh green `main` build.
- [ ] Perform the post-merge admission-policy and normal-global-sync acceptance.
