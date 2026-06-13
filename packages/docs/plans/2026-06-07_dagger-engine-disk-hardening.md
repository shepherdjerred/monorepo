# Dagger Engine Disk Hardening

## Status

In Progress (PR open)

## Context

main CI build [3668](https://buildkite.com/sjerred/monorepo/builds/3668) failed: the Dagger
engine PVC hit its 1 Ti ZFS quota mid-build (`disk quota exceeded`), killing 6 image pushes.
Immediate fix: PVC expanded 1 → 2 Ti online. This change addresses the two durable gaps the
incident exposed, plus a conservative GC retune. Full reasoning in the
[decision record](../decisions/2026-06-07_dagger-gc-and-pvc-drift.md).

(The SeaweedFS `aws: not found` failure in the same build was unrelated and fixed separately
in [PR #1109](https://github.com/shepherdjerred/monorepo/pull/1109).)

## Changes

1. **Early-warning alerts** — `rules/dagger.ts` (`getDaggerEngineRuleGroups`):
   `DaggerEnginePVCStorageHigh` (>85%, 15m, warning) + `DaggerEnginePVCStorageCritical`
   (>95%, 5m, critical) on `kubelet_volume_stats_*{persistentvolumeclaim="data-dagger-dagger-helm-engine-0"}`,
   registered in `monitoring/prometheus.ts` (namespace `dagger`). Routes to PagerDuty.
2. **GC retune (conservative, metrics-driven)** — `dagger.ts` `configJson.gc`:
   `maxUsedSpace` 600 → **800 GB**, `reservedSpace` 100 → **200 GB**, `minFreeSpace` 20% kept,
   absolute units. Live metrics (2 Ti cap, ~1.06 Ti used, ~560 GB above the cache cap) ruled
   out the aggressive ~1.4 Ti originally floated.
3. **Docs** — manual PVC-resize runbook, decision record, this plan mirror; the `dagger.ts`
   PVC comment now points at the runbook.

**Explicitly not done:** self-healing PVC-resize Job (owner declined). Drift is handled by
runbook + the alert as the safety net.

## Verification

- Local: `bun run typecheck`, `bunx eslint . --fix`, `bun run build` (cdk8s synth renders
  `prometheus-dagger-engine-rules`), pre-commit `homelab-helm-lint`.
- Metrics pulled from Grafana (`kubelet_volume_stats`) to size the GC value.
- Post-merge: `kubectl get prometheusrule -n dagger prometheus-dagger-engine-rules`; confirm
  alerts in Prometheus; after sync, `kubectl rollout restart statefulset/dagger-dagger-helm-engine -n dagger`
  to apply the new GC config; confirm engine healthy + green CI build.

## Session Log — 2026-06-07

### Done

- Diagnosed build 3668 (EDQUOT on the engine PVC); expanded PVC 1 → 2 Ti online (authorized).
- Researched + verified GC semantics (config IS applied; `maxUsedSpace` bounds only reclaimable
  cache; ZFS `quota` reflects in statfs; STS VCT immutability). Pulled live usage from Grafana.
- Added engine PVC alerts (`rules/dagger.ts` + `prometheus.ts`), conservative GC retune
  (800 GB / 200 GB), runbook + decision record.

### Remaining

- Merge PR; after ArgoCD sync, restart the engine to apply the GC change.
- Revisit `maxUsedSpace` once the new alerts give a few days of steady-state usage data.

### Caveats

- The ~560 GB sitting above the 600 GB cache cap isn't fully diagnosed (engine `exec` /
  `buildctl du` was denied); the conservative GC value reflects that uncertainty.
- GC config only takes effect on engine restart (read at startup).
