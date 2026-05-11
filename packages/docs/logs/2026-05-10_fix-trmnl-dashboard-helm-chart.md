# Fix trmnl-dashboard helm chart skeleton

## Status

Complete

## Problem

Buildkite build [#1915](https://buildkite.com/sjerred/monorepo/builds/1915) on `main` failed at the `helm-push-trmnl-dashboard` step:

```
stat packages/homelab/src/cdk8s/helm/trmnl-dashboard: no such file or directory
```

Dagger's `helmPackageHelper` (`.dagger/src/release.ts:44`) reads
`packages/homelab/src/cdk8s/helm/<chartName>` to seed the Helm package
(it copies the synthesized `<chartName>.k8s.yaml` into `templates/` and
`sed`-replaces `$version` / `$appVersion` in `Chart.yaml`). The directory
didn't exist for `trmnl-dashboard`.

`scripts/ci/src/catalog.ts:51,249,312` registered the chart, the cdk8s
chart at `packages/homelab/src/cdk8s/src/cdk8s-charts/trmnl-dashboard.ts`
existed, and the ArgoCD app was wired up — but step 2 from
`packages/homelab/CLAUDE.md` ("Helm Chart Directory —
`src/cdk8s/helm/{name}/Chart.yaml`") was skipped.

## Fix

Create `packages/homelab/src/cdk8s/helm/trmnl-dashboard/Chart.yaml`
matching the minimal pattern used by other recently-added charts (e.g.
`tasknotes`, which packaged successfully in the same build).

## Files touched

- `packages/homelab/src/cdk8s/helm/trmnl-dashboard/Chart.yaml` (new)
- `packages/docs/plans/2026-05-10_fix-trmnl-dashboard-helm-chart.md` (this file)
- `packages/docs/index.md` (link the new plan)

## Verification

- Re-run the failing Buildkite step on the next push to `main`.
- Confirm the chart appears in ChartMuseum at `chartmuseum.sjer.red/api/charts/trmnl-dashboard`.
- ArgoCD `trmnl-dashboard` Application syncs the new chart version.

## Session Log — 2026-05-10

### Done

- Diagnosed Buildkite #1915 `helm-push-trmnl-dashboard` failure: missing chart skeleton at `packages/homelab/src/cdk8s/helm/trmnl-dashboard/`.
- Confirmed `helmPackageHelper` only requires `Chart.yaml` (templates dir is created on the fly from cdk8s synth output).
- Created `packages/homelab/src/cdk8s/helm/trmnl-dashboard/Chart.yaml` mirroring the `tasknotes` pattern.
- Linked this plan from `packages/docs/index.md`.

### Remaining

- Push the fix and re-trigger CI on `main` to confirm the helm-push step turns green.

### Caveats

- Other failing jobs in #1915 are independent: Knip and Trivy are soft failures (per `feedback_soft_failures_ci.md` / `2026-04-05_ci-quality-hardening.md`); the broken `code-review` and three `tofu-plan-*` jobs share a separate root cause (likely upstream-failed dependency or agent loss) and are out of scope for this plan.
