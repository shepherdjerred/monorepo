# Decision: Dagger Engine GC Semantics & PVC-Drift Hardening

**Date:** 2026-06-07
**Status:** Accepted
**Triggered by:** main CI build [3668](https://buildkite.com/sjerred/monorepo/builds/3668) — `disk quota exceeded` killed 6 image pushes

## Context

The Dagger engine cache lives on one ZFS-backed PVC (`data-dagger-dagger-helm-engine-0`,
namespace `dagger`). Build 3668 failed because that PVC hit its **1 Ti ZFS dataset quota**
mid-build; writes to `containerdmeta.db` / `metadata_v2.db` returned EDQUOT. The PVC was
expanded to 2 Ti online to clear the outage. Investigation surfaced durable issues worth
recording so future tuning doesn't repeat the same wrong assumptions.

## Findings (the durable knowledge)

1. **`gc.maxUsedSpace` bounds only the _reclaimable_ BuildKit cache, not total dataset usage.**
   Metadata DBs, active leases, and in-flight exec mounts are uncounted. Empirically (live
   metrics, post-expansion): **2 Ti capacity, ~1.06 Ti used while the cap was 600 GB** — i.e.
   ~560 GB sits _above_ the cache cap. So `maxUsedSpace` is **not** a disk-usage ceiling.
   Corroborated by [dagger#7711](https://github.com/dagger/dagger/issues/7711) ("the cache can
   consume the entire disk despite the GC").

2. **GC is a reactive, rate-limited background target, not a write barrier.** It sweeps
   _toward_ the policy (`sweepSize` per pass). A heavy concurrent build (3668 had 195 jobs;
   the 2026-02 incident measured 130–177 MB/s sustained) outruns reclamation and much of the
   consumption is non-reclaimable while operations are in flight — so usage hits the hard
   quota between/despite sweeps.

3. **ZFS `quota` (what OpenEBS sets, `quotaType:"quota"`) IS reflected in `statfs`/`df`** for
   the dataset it's set on (per Oracle ZFS docs). So `minFreeSpace` is _not_ blind to the
   quota — but per (2) it still can't preempt an instantaneous EDQUOT. Treat `minFreeSpace`
   as belt-and-suspenders, not the guard.

4. **Default / `%`-based GC policy is unsafe here.** The default keeps cache under "75% of
   total disk / 20% free"; on a quota'd dataset smaller than its pool the percentages can
   read pool-level space. Use an **absolute** `maxUsedSpace` kept comfortably below the quota.

5. **StatefulSet `volumeClaimTemplate` is immutable**, and ArgoCD ignores it
   (`ignoreDifferences` on `.spec.volumeClaimTemplates[]`). So changing `storage:` in code
   never resizes the live PVC — a manual `kubectl patch` is required. This drift (code 2 Ti,
   live 1 Ti) was the proximate cause of the outage.

## Decisions

- **Real safety = total headroom**, delivered by the **2 Ti PVC expansion** (done) — not by
  the GC knob. `maxUsedSpace` ≠ EDQUOT lever.
- **GC retune: conservative.** Raise `maxUsedSpace` 600 → **800 GB** (+ `reservedSpace` 200 GB),
  restoring the pre-2026-02 value now that the disk-I/O drivers (concurrency via Kueue,
  `compression=lz4`, `sync=disabled`) are mitigated. **Not** the ~1.4 Ti originally floated —
  the live ~560 GB over-cap footprint means an aggressive cap could push total toward the new
  quota under load. Keep absolute units. Revisit once the new alerts give steady-state data.
- **Early warning, not automation.** Add `DaggerEnginePVCStorageHigh` (>85%) /
  `DaggerEnginePVCStorageCritical` (>95%) PrometheusRules on the engine PVC (→ PagerDuty).
  No self-healing resize Job (owner declined); PVC resize stays a documented manual runbook.

## Consequences

- Disk has ~1 Ti of headroom; the alerts catch the next approach to the wall before a red build.
- Further GC tuning is now observable/safe via the alerts + `kubelet_volume_stats`.
- GC config changes require an engine restart to take effect (read at startup only).

## Addendum — 2026-07-03 recurrence

The disk-full failure recurred on 2026-07-03 and validated this record's findings
in production:

- **Finding #2 confirmed at scale**: a Renovate rebase-wave build storm (89 builds
  in 3h; 8 dep branches rebuilt simultaneously after a main merge) wrote ~670 GB
  in 100 minutes (~110 MB/s net) straight through a healthy, live GC config to a
  100%-full deadlock. GC tuning is not — and cannot be — the guard against bursts.
- **Finding #4 was being violated by our own config**: `minFreeSpace` was set to
  `"20%"` while this record says never use `%` on the quota'd dataset. Fixed to
  `"400GB"` absolute in the 2026-07-03 fixes PR.
- **Finding #5 bit again in reverse**: the recovery PV recreate provisioned from
  the live STS template, which was still 1Ti (code said 2Ti) — VCT immutability
  drift regressed the fresh volume. New op (STS `--cascade=orphan` recreate) added
  to the runbook to bake template changes into the live STS.
- **"Early warning, not automation" needed a burst-shaped alert**: the 85%/95%
  threshold alerts fired and paged but gave ~7 minutes of lead time against a
  100-minute burst, and drowned in an incident storm.
  `DaggerEnginePVCFillPredicted` (predict_linear, 15m window, 2h horizon, >60%
  usage guard) was added; it backtests to ~70 minutes of lead on this incident.
- **New decision — smooth the input**: `prConcurrentLimit: 3` in `renovate.json`
  caps how many dep branches can be open (and thus rebase/rebuild at once).

Post-mortem: [2026-07-03_dagger-engine-disk-full-outage.md](../logs/2026-07-03_dagger-engine-disk-full-outage.md)

## References

- Runbook: [2026-06-07_dagger-engine-pvc-resize.md](../guides/2026-06-07_dagger-engine-pvc-resize.md)
- Prior art: [2026-02-23_dagger-disk-write-amplification.md](./2026-02-23_dagger-disk-write-amplification.md)
- [Dagger engine GC config](https://docs.dagger.io/reference/configuration/engine/), dagger#7711 / #10504
