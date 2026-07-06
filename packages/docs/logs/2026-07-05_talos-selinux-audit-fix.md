# Talos SELinux Audit Log Fix

## Status

Partially Complete

## Summary

Talos node health was green, but `/var/log/auditd.log` was noisy with SELinux AVC denials. Talos is running SELinux in permissive mode, so the denials were diagnostic log noise rather than enforcement failures.

The high-volume denials were from ZFS-backed writers touching PVC paths with `unlabeled_t` labels:

- Current log: Scout prod/beta `bun` processes writing `/data` on `zfs-ssd` PVCs.
- Rotated log: ClickHouse background threads writing `/var/lib/clickhouse` on a `zfs-ssd` PVC.

The live OpenEBS ZFS CSIDriver has `spec.seLinuxMount: false`, so Kubernetes uses recursive volume relabeling. The manifest fix is to set explicit pod-level `seLinuxOptions.level` values for the high-churn ZFS-backed deployments so kubelet/container runtime relabels the mounted volume tree for each pod.

## Changes

- Added `applyZfsVolumeSelinuxRelabeling()` in `packages/homelab/src/cdk8s/src/misc/selinux.ts`.
- Applied explicit SELinux labels to:
  - `plausible-clickhouse`: `s0:c101,c201`
  - `scout-beta-scout-backend`: `s0:c220,c221`
  - `scout-prod-scout-backend`: `s0:c222,c223`
- Added `packages/homelab/src/cdk8s/src/zfs-selinux-relabeling.test.ts` to assert those labels remain present in synthesized deployments.

No live cluster mutation was performed; this must ship through the normal GitOps/ArgoCD path.

## Verification

- `bunx eslint src/misc/selinux.ts src/resources/analytics/clickhouse.ts src/resources/scout/index.ts src/zfs-selinux-relabeling.test.ts --fix`
- `bun test src/zfs-selinux-relabeling.test.ts`
- `bun run typecheck`
- `bun run build`
- `bun run test`

The generated manifests contain:

- `dist/plausible.k8s.yaml`: `seLinuxOptions.level: s0:c101,c201`
- `dist/scout-beta.k8s.yaml`: `seLinuxOptions.level: s0:c220,c221`
- `dist/scout-prod.k8s.yaml`: `seLinuxOptions.level: s0:c222,c223`

## Caveats

- `bun run scripts/setup.ts` in the new worktree failed in the Scout data package because `@shepherdjerred/llm-models` could not be resolved from `packages/scout-for-lol/packages/data/src/review/models.ts`. The homelab package dependencies and checks still completed, and the unrelated generated Scout template DB artifact was restored.
- This fix targets the confirmed dominant audit sources. Smaller rotated-log sources such as pyroscope, dagger-engine, tempo, and loki may still need the same pattern if they continue to show AVCs after Scout and ClickHouse roll.

## Session Log — 2026-07-05

### Done

- Investigated the SELinux AVC flood back to high-churn ZFS PVC writers.
- Added the CDK8s SELinux relabeling helper and applied it to Scout prod, Scout beta, and ClickHouse.
- Added a regression test for the synthesized SELinux levels.
- Verified lint, focused test, typecheck, build, and full cdk8s test suite.

### Remaining

- Let ArgoCD apply the generated manifests and roll the affected pods.
- Recheck `/var/log/auditd.log` after rollout; extend the helper to any remaining high-volume ZFS-backed writers if needed.

### Caveats

- No live cluster state was changed in this session.
- The setup script hit the known Scout dependency issue noted above, but the relevant homelab checks passed.

## Session Log — 2026-07-05 PR Publication

### Done

- Committed the scoped fix on `fix/talos-selinux-audit`.
- Pushed `fix/talos-selinux-audit` to `origin`.
- Opened draft PR #1415: `https://github.com/shepherdjerred/monorepo/pull/1415`.

### Remaining

- Wait for PR CI/review.
- Merge through the normal GitOps path, then let ArgoCD roll the affected pods.
- Recheck `/var/log/auditd.log` after rollout.

### Caveats

- The PR is intentionally draft.
- No live cluster state was changed during publication.

## Session Log — 2026-07-05 PR Review Follow-up

### Done

- Addressed Greptile P2 feedback by centralizing ZFS SELinux MCS levels in `packages/homelab/src/cdk8s/src/misc/selinux.ts`.
- Added fail-fast validation that a deployment has pod `securityContext` before applying the SELinux JSON patch.
- Made Scout's pod-level `securityContext` explicit instead of relying on cdk8s-plus synthesis behavior.
- Added regression coverage that the MCS category pairs stay unique.
- Verified `bunx eslint src/misc/selinux.ts src/resources/analytics/clickhouse.ts src/resources/scout/index.ts src/zfs-selinux-relabeling.test.ts --fix`, `bun test src/zfs-selinux-relabeling.test.ts`, `bun run typecheck`, `bun run build`, and `bun run test`.

### Remaining

- Wait for a fresh Buildkite PR build to replace canceled build `5097`.
- Recheck unresolved review threads after Greptile reviews the new head commit.

### Caveats

- Buildkite build `5097` was canceled before the pipeline upload job produced useful logs.
