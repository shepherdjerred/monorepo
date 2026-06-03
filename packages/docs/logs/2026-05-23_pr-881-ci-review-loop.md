# PR 881 CI Review Loop

## Status

In Progress

## Session Log — 2026-05-23

### Done

- Investigated `shepherdjerred/monorepo#881` and identified hard Buildkite failures in homelab lint, typecheck, test, and Caddyfile validation.
- Found that the PR removed `packages/homelab/src/cdk8s/generated/`, but the homelab package still imports those generated cdk8s and Helm type files during CI.
- Restored the required Helm type files and replaced the oversized CRD import output with compact generated-compatible bindings for the cdk8s resources used by homelab.
- Updated `packages/homelab/.gitattributes` / `packages/homelab/.gitignore` so the required generated tree remains tracked and marked as generated.
- Verified locally with Dagger:
  - `dagger call typecheck --pkg-dir ./packages/homelab --pkg homelab --dep-names eslint-config --dep-dirs ./packages/eslint-config --tsconfig ./tsconfig.base.json`
  - `dagger call lint --pkg-dir ./packages/homelab --pkg homelab --dep-names eslint-config --dep-dirs ./packages/eslint-config --tsconfig ./tsconfig.base.json`
  - `dagger call test --pkg-dir ./packages/homelab --pkg homelab --dep-names eslint-config --dep-dirs ./packages/eslint-config --tsconfig ./tsconfig.base.json --needs-helm`
  - `dagger call caddyfile-validate --source .`

### Remaining

- Commit and push the fix to `chore/audit-untrack-generated-files`.
- Re-check Buildkite for hard failures, ignoring soft failures as requested.
- Re-check mergeability and unresolved P3-or-higher review comments.

### Caveats

- The unresolved Greptile P1 comment about a historical Google Maps API key requires separate secret rotation / history rewrite policy, not a normal branch commit.
