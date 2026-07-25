---
id: reference-dagger-migration-2026-07-03-dagger-disk-full-root-cause-and-fixes
type: reference
status: complete
board: false
---

# Dagger Engine Disk-Full — Root-Cause Correction & Durable Fixes

## Context

The 2026-07-03 Dagger engine disk-full outage (~2.5h CI-wide, ~15 PRs blocked) was
post-mortem'd in `packages/docs/logs/2026-07-03_dagger-engine-disk-full-outage.md`,
which originally claimed root cause = "no cache GC / keep-storage limit configured."

**Investigation proved that claim wrong.** Evidence (Prometheus, Loki, Buildkite
API, PagerDuty API, live cluster):

- **GC is configured and live**: `/etc/dagger/engine.json` (ConfigMap
  `dagger-dagger-helm-engine-config`) = `{gc: {maxUsedSpace: 800GB, reservedSpace:
200GB, minFreeSpace: 20%}}` from
  `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`.
  Usage was flat at ~1330GB/60% for days before the outage — GC works at steady state.
- **Actual mechanism**: a dep-bump build storm — 89 builds created 16:30–19:30 UTC.
  Trigger: main build #4794 passed 17:35 → merge → every open Renovate branch
  rebased simultaneously at 17:41 (automerge needs up-to-date branches), each
  spawning 11–91-job builds, alongside mass-dep-bump branches. Dep bumps are
  worst-case for cache (new lockfiles/base images invalidate every layer; in-flight
  data is unGC-able). Result: **~670GB written in 100 min (~110MB/s net)**,
  17:40→19:20. GC is reactive/rate-limited (June decision record finding #2)
  and cannot outrun this. At 100%, BuildKit deadlocks: GC must write
  `worker/metadata_v2.db` to prune → `SQLITE_FULL`/EDQUOT.
- **Alerts fired and paged**: warning 19:13, critical 19:53 (builds failing ~19:20 —
  7 min lead time), but drowned in a ~30-incident PagerDuty storm (node saturation
  18:05, 157MB/s writes, collateral Postal outage). Diagnosis began ~21:55.
- **Live STS volumeClaimTemplate is still 1Ti** (STS created 2026-04-05; VCTs
  immutable; ArgoCD ignores them). Code's 2Ti is cosmetic — why the recovery PV
  recreate regressed to 1Ti, and will again until the STS object is recreated.
- `cancel_intermediate_builds`/`skip_intermediate_builds` already enabled
  (`packages/homelab/src/tofu/buildkite/pipeline.tf`) — supersession is not the gap.
- Renovate (`renovate.json`): `prHourlyLimit: 5` (creation only), no
  `prConcurrentLimit` → default 10 open branches → 10-branch rebase waves.

## Scope decisions (user-confirmed)

- Ballast escape hatch: **skipped** (runbook reorder only — expand-first).
- GC retune: **minFreeSpace only** (`20%` → absolute `400GB`); keep 800GB cap.
- Renovate: **yes**, add concurrency limit.
- Live cluster ops: **document only** — exact commands in the runbook; user runs them.

## Changes shipped

1. **Predictive PVC alert** —
   `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/dagger.ts`:
   new `DaggerEnginePVCFillPredicted` (critical, `for: 10m`):
   `predict_linear(used[15m], 2h) > capacity AND used/capacity > 0.6`.
   Backtested against the incident (fires with ~70 min lead) and against the prior
   quiet week (silent).
2. **GC minFreeSpace** —
   `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`:
   `minFreeSpace: "20%"` → `"400GB"` (the `%` form contradicted the June decision
   record's "keep absolute byte values" rule). Requires engine restart to load.
3. **Renovate concurrency** — `renovate.json`: `"prConcurrentLimit": 3`
   (`branchConcurrentLimit` inherits it) → rebase waves cap at 3 branches.
4. **Runbook rewrite** —
   `packages/docs/guides/2026-06-07_dagger-engine-pvc-resize.md`: recovery order
   corrected (online expand FIRST — it un-deadlocks GC; purge demoted to
   "unreliable"; PV recreate last resort), new STS orphan-recreate op to bake VCT
   size changes into the live STS, and a pending-ops checklist for the user-run
   commands.
5. **Outage log correction** —
   `packages/docs/logs/2026-07-03_dagger-engine-disk-full-outage.md`: root cause
   rewritten with the measured mechanism + explicit correction notice; follow-ups
   updated (the "[HIGH] configure GC" item dropped as already-existing).
6. **Decision record addendum** —
   `packages/docs/decisions/2026-06-07_dagger-gc-and-pvc-drift.md`: 2026-07-03
   recurrence section (finding #2 validated; finding #4 self-violation fixed;
   finding #5 reverse-drift; new smoothing decision).

## Post-merge (user-run ops, in order)

See the runbook's "Pending ops checklist (2026-07-03 fixes)":

1. Wait for ArgoCD to sync the `dagger` app (ConfigMap + PrometheusRule + STS manifest).
2. STS orphan-recreate (bakes 2Ti VCT): `kubectl -n dagger delete sts
dagger-dagger-helm-engine --cascade=orphan`, verify template shows 2Ti.
3. `kubectl rollout restart statefulset/dagger-dagger-helm-engine -n dagger`
   off-peak (loads `minFreeSpace: 400GB`).
4. `kubectl delete pv pvc-5e89054d-516e-4bd0-9a8b-9b6b7b0703c2` (cosmetic cleanup).

## Verification performed

- `packages/homelab`: `bun run typecheck`, `bun run test`, `bunx eslint .` clean.
- Root `bun run typecheck` clean.
- `renovate-config-validator renovate.json` clean.
- Alert expression backtested via Grafana/Prometheus over the incident window and
  the prior 7 quiet days.
