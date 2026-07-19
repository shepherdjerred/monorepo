---
id: log-2026-07-03-dagger-engine-disk-full-outage
type: log
status: complete
board: false
---

# Dagger CI Engine Disk-Full Outage — Post-Mortem & Runbook

## TL;DR

The homelab Dagger CI engine (`dagger-dagger-helm-engine-0`, ns `dagger`) went
hard-down for ~2.5h on 2026-07-03. **Root cause: a dep-bump build storm wrote
~670 GB in 100 minutes, outrunning BuildKit GC and filling the 2.2 TB build-cache
volume to 100%, where the engine deadlocks** — GC must _write_ metadata
(`worker/metadata_v2.db`) to prune, and there was no free space to write. Every
Buildkite build across all branches failed at the Dagger `load workspace` step,
blocking ~15 PRs.

> **Correction:** the first draft of this post-mortem blamed a missing GC
> config ("the engine has no cache GC/size limit configured"). **That was wrong.**
> GC was configured and live the whole time — `/etc/dagger/engine.json` (ConfigMap
> `dagger-dagger-helm-engine-config`) contained
> `{gc: {maxUsedSpace: 800GB, reservedSpace: 200GB, minFreeSpace: 20%}}`, and
> steady-state usage sat flat at ~1.33 Ti / 60% for days beforehand. The draft
> checked container args and env vars — but the GC config rides in a mounted file.
> No GC setting prevents this failure mode (GC is a reactive, rate-limited
> sweeper, per the June decision record); only headroom, input smoothing, and
> faster detection do.

Recovery took three escalating steps: in-place cache purge (partial) → full PV
recreate (clean, but landed on a smaller 1Ti volume) → online expand back to 2Ti.
**Do them in the opposite order next time: online expand FIRST** — it is instant,
lossless, and un-deadlocks GC.

## Timeline (2026-07-03, UTC)

| Time           | Event                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (prior week)   | Disk usage flat at ~1330 GB / 60% of 2.2 TB — GC holding steady state.                                                                                                                                                          |
| 17:35          | Main build #4794 passes → merge to main.                                                                                                                                                                                        |
| 17:40–17:46    | **Build storm begins**: every open Renovate branch rebases against new main and rebuilds at once (8 branches within one minute at 17:41), alongside mass-dep-bump and 91-job main builds — 89 builds created 16:30–19:30 total. |
| 17:40→19:20    | **~670 GB written in 100 min (~110 MB/s net)**. Dep bumps are worst-case for cache: new lockfiles/base images invalidate every layer; in-flight data is unGC-able. Node pages fire (load, 157 MB/s writes, CPU) starting 18:05. |
| ~19:09–19:15   | Last known-good builds (#4872, #4876).                                                                                                                                                                                          |
| 19:13          | `DaggerEnginePVCStorageHigh` (>85%) fires and pages PagerDuty.                                                                                                                                                                  |
| ~19:20         | Cache hits 100%; builds start failing at `load workspace: . ERROR`.                                                                                                                                                             |
| 19:53          | `DaggerEnginePVCStorageCritical` (>95%) fires and pages. Both Dagger pages drown in a ~30-incident storm (node saturation + collateral Postal outage on the IO-starved node).                                                   |
| ~20:16–20:27   | A _separate, brief_ dagger.cloud telemetry blip (`failed to emit telemetry … trace information incomplete`; jobs exit 1 _after_ all steps pass). Overlapped and initially masked the cause.                                     |
| 20:29:55       | Engine container crashes (exitCode 2), self-restarts — but PVC still full, comes back deadlocked.                                                                                                                               |
| ~21:55         | Diagnosed disk-full deadlock via engine logs + `df`.                                                                                                                                                                            |
| ~22:05         | In-place purge (`rm worker/ + cache dbs`) + pod restart → freed only to 87% (live engine recreated `worker/` + held FDs).                                                                                                       |
| ~22:30         | Disk re-filling under the cold-cache rebuild burst (277G→135G in minutes); re-deadlock imminent.                                                                                                                                |
| ~22:33         | Operator directs full reset: scale-0 → delete PVC/PV/ZFSVolume → scale-1. Fresh **1Ti** volume (live STS template — see below), engine healthy, CI restored.                                                                    |
| ~22:40+        | ~15 PRs re-triggered; cold-cache builds slow, surface a family of transient failures (below).                                                                                                                                   |
| ~01:10 (07-04) | Cache creeps back up on the 1Ti volume under sustained rebuild load; operator expands PVC **1Ti→2Ti online** (no restart). Disk 63%→32%.                                                                                        |

## Root cause (corrected)

Three layers, none of which is "GC was missing":

1. **Input burst.** A merge to main at 17:35 triggered a simultaneous rebase of
   every open Renovate branch (automerge requires up-to-date branches;
   `renovate.json` had `prHourlyLimit: 5` — which only limits PR _creation_ — and
   no `prConcurrentLimit`, so ~10 dep branches were open). Together with
   mass-dep-bump and repeated 91-job main builds, 89 builds ran in 3 hours. Dep
   bumps invalidate every cached layer, so nearly all writes were fresh blobs.

2. **GC physics.** BuildKit GC is a reactive, rate-limited background sweeper
   (June decision record finding #2). It cannot count in-flight/leased data and
   cannot reclaim at 110 MB/s. The ~900 GB of headroom above steady state was
   gone in ~100 minutes.

3. **The 100% deadlock.** At quota, GC's own metadata writes
   (`worker/metadata_v2.db`) fail with EDQUOT, so it can never free space again —
   self-sustaining until an operator raises the quota (online expand) or resets
   the volume.

**Detection failed operationally, not mechanically**: both PVC alerts fired and
paged, but the warning gave only ~7 minutes of lead time against a 100-minute
burst (thresholds were tuned for slow creep), and both pages were buried in an
alert storm. The new `DaggerEnginePVCFillPredicted` alert (predict_linear, 2h
horizon) backtests to ~18:10 on this incident — ~70 minutes of lead time.

**Why the recreate regressed to 1Ti:** StatefulSet `volumeClaimTemplates` are
immutable and ArgoCD explicitly ignores them, so the live STS (created
2026-04-05) still carries the original **1Ti** template even though code says 2Ti.
The fresh PVC was provisioned from the live template. Fix: STS orphan-recreate op
in the [resize runbook](../guides/2026-06-07_dagger-engine-pvc-resize.md).

### Log signatures (engine)

```
level=error msg="failed to serve request"
  error="open client db: ping .../clientdbs/<id>.db...: unable to open database file: out of memory (14)"
level=error msg="gc error: write /var/lib/dagger/worker/metadata_v2.db: disk quota exceeded ..."
```

`out of memory (14)` is SQLite's `SQLITE_FULL`. Client-side, builds report
`load workspace: . ERROR` / `unexpected EOF` because the engine can't open its DBs.

### Disk state at diagnosis

```
zfspv-pool-nvme/pvc-5e89054d-...  2.1T  2.1T  0  100%  /var/lib/dagger
```

## Diagnosis runbook (do this first next time)

```bash
# 1. Engine erroring / restarting?
kubectl -n dagger get pod dagger-dagger-helm-engine-0            # restart count climbing?
kubectl -n dagger logs dagger-dagger-helm-engine-0 --since=5m \
  | grep -iE "out of memory|disk quota|load workspace.*ERROR"

# 2. Cache volume full?  (the smoking gun)
kubectl -n dagger exec dagger-dagger-helm-engine-0 -- df -h /var/lib/dagger
```

**Real-vs-infra tell for the babysitter agents** — read the failed job log:

| Log signature                                                     | Meaning                                                | Action                       |
| ----------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| `load workspace: . ERROR` / `unexpected EOF` before any step      | engine down (disk-full / crash)                        | fix engine, don't touch code |
| all steps ✔ then `exited status 1` after the `dagger.cloud` trace | telemetry/trace blip                                   | retry (transient)            |
| `failed to rename .../snapshots/new-…: file exists`               | buildkit snapshot-rename race, cold-cache concurrency  | retry (transient)            |
| `EEXIST: failed to link package: @shepherdjerred/eslint-config …` | bun parallel-install link race on a shared `file:` dep | retry the job (transient)    |
| heavy job `exit=-1` (e.g. `docker: Build temporal-worker`)        | process killed (OOM) on cold cache                     | retry the job (transient)    |

## Recovery — corrected order

Full procedures live in the
[resize runbook](../guides/2026-06-07_dagger-engine-pvc-resize.md). Summary of
what was learned:

1. **Online PVC expand — do this FIRST** (it was discovered last during this
   incident). Instant ZFS quota bump, no restart, no lost cache, and it
   un-deadlocks GC by giving it room to write metadata. During recovery:
   1Ti→2Ti flipped capacity in ~30s, disk 63%→32%, zero disruption.
2. **Full PV recreate — last resort.** scale-0 → delete PVC → **delete the openebs
   `ZFSVolume` CR** (reclaimPolicy is Retain; the PVC/PV deletion alone frees
   nothing) → scale-1. Bake the correct VCT size into the live STS first or the
   fresh volume regresses to the stale template size (bit us: 2Ti → 1Ti).
3. **In-place purge (`rm -rf worker/ …`) — do not rely on it.** The live engine
   recreates `worker/` faster than `rm` deletes and holds FDs to deleted blobs;
   freed only to 87% here and re-filled within minutes.

## Systemic learnings surfaced during the cold-cache recovery

Recreating the volume gave a **cold cache**; ~15 PRs rebuilt at once, exposing a
family of issues. These recur whenever the cache is cold (fresh volume, engine
restart):

1. **macOS bun generates a divergent `bun.lock` vs Linux CI's bun.** A full
   lockfile regen done locally on macOS can FAIL `bun install --frozen-lockfile`
   on Linux CI (72 packages differed in one case), shown as _"lockfile had
   changes, but lockfile is frozen"_. **Fix pattern:** don't full-regen on macOS —
   start from main's exact committed `bun.lock`
   (`git checkout origin/main -- <path>/bun.lock`) and `bun install` only the
   minimal delta.
2. **`EEXIST: failed to link @shepherdjerred/eslint-config`** — bun
   parallel-install link race on the shared `file:` dep, hits concurrent
   pkg-checks on a cold cache. Transient; retry the job. Diminishes as cache warms.
3. **Heavy satori/resvg renders time out at the 5s default** on the (slower) cold
   Dagger engine — two scout tests hit it (Arena report + backend chart report).
   Real fix: `setDefaultTimeout(30_000)` on the heavy-render suites.
4. **Heavy docker builds `exit=-1`** (e.g. `docker: Build temporal-worker`) =
   OOM/process-kill on cold cache. Retry the single job.
5. **Stale check statuses:** a job that ran on a build later killed/superseded
   keeps its red status on the commit until a NEW build re-runs _that job_. If the
   PR's dynamic pipeline doesn't re-run it (out of changed-file scope), rebuild the
   OLD build number to clear it. Don't mistake a stale red for a live failure.
6. **`scout-for-lol/bun.lock` was left stale on main by #1383** (added new
   workspace sub-packages app/report/ui/desktop without updating the lockfile) —
   why scout PRs kept needing lockfile reconciliation. Worth a follow-up PR that
   regenerates it **on a Linux runner**.

## Impact on PRs

No PR code was at fault. All open PRs' "failures" during the window were infra.
Babysitter agents were told to **hold** (stop retrying — futile on a full disk),
then **re-trigger** after recovery. Agents re-trigger builds with
`bk build rebuild <prior-build-number>` (a direct `bk build create` on a feature
branch is 422-rejected by pipeline branch-filtering); individual flaked jobs are
retried with `bk job retry` (preserves the green jobs on that build).

## Follow-ups

Durable fixes implemented in the fixes PR (see
[plan](../plans/2026-07-03_dagger-disk-full-root-cause-and-fixes.md)):

- ~~Configure a Dagger engine cache GC / keep-storage limit~~ — **dropped: it
  already existed and was live during the outage** (the original draft's root
  cause was wrong).
- **[DONE — fixes PR]** `DaggerEnginePVCFillPredicted` predictive alert
  (predict_linear, 2h horizon, >60% guard) — ~70 min lead time on this incident's
  fill rate vs 7 min from the threshold alerts.
- **[DONE — fixes PR]** `renovate.json` `prConcurrentLimit: 3` — caps the
  rebase-wave width that produced the write burst.
- **[DONE — fixes PR]** GC `minFreeSpace` `20%` → absolute `400GB` (the `%` form
  contradicted the June decision record's own rule).
- **[OPS PENDING]** Bake 2Ti into the live STS template (orphan-recreate), reload
  GC config (rollout restart, off-peak), delete Released PV `pvc-5e89054d-…` —
  exact commands in the
  [runbook's pending-ops checklist](../guides/2026-06-07_dagger-engine-pvc-resize.md#pending-ops-checklist-2026-07-03-fixes).
- **[LOW, unchanged]** Regenerate `packages/scout-for-lol/bun.lock` on Linux to fix
  the stale entries from #1383.

## Session Log — 2026-07-03

### Done

- Diagnosed the CI-wide outage as a Dagger engine disk-full deadlock (not a
  cache blip, not any PR's code).
- Recovered in 3 steps: in-place purge (partial) → full PV recreate
  (scale-0 → delete PVC/PV/ZFSVolume → scale-1) → online expand 1Ti→2Ti.
- Restored CI; drove ~15 blocked PRs back through builds on the fresh engine.
- Captured the cold-cache transient taxonomy + the macOS/Linux lockfile gotcha.

### Remaining

- Durable fixes (root cause + prevention) — done in the follow-up session below.

### Caveats

- The in-place `rm` purge is unreliable while the engine runs (recreates `worker/`
  - holds FDs). Prefer online PVC expand (least disruptive) or the full scale-0 →
    delete-PVC → delete-ZFSVolume → scale-1 recreate.
- reclaimPolicy is **Retain**: you MUST delete the openebs `ZFSVolume` CR (not just
  the PVC/PV) to actually free the ZFS dataset from the pool.
- Cold-cache rebuild bursts produce many transient failures (EEXIST link race,
  snapshot-rename, heavy-render timeout, docker OOM `exit=-1`) — retry, don't
  code-fix. They diminish as the cache warms.

## Session Log — 2026-07-03 (evening: root-cause investigation & fixes)

### Done

- **Disproved the draft root cause**: verified GC config is live in the engine
  (`/etc/dagger/engine.json` mounted from ConfigMap) and that steady-state usage
  was flat at ~1330 GB / 60% for the prior week (Prometheus).
- **Established the real mechanism** with data: Buildkite API shows 89 builds
  16:30–19:30 incl. an 8-branch Renovate rebase wave at 17:41 (after main #4794
  passed 17:35); kubelet volume stats show ~670 GB written 17:40→19:20; PagerDuty
  API confirms both PVC alerts fired/paged (19:13, 19:53) but drowned in a
  ~30-incident storm.
- **Confirmed live STS VCT is still 1Ti** (vs 2Ti in code) — the recreate-regression
  trap.
- Implemented fixes (single PR): `DaggerEnginePVCFillPredicted` predictive alert
  (`rules/dagger.ts`), `minFreeSpace` 20%→400GB (`dagger.ts`),
  `prConcurrentLimit: 3` (`renovate.json`), runbook rewrite with expand-first
  ordering + STS orphan-recreate op + pending-ops checklist, this log correction,
  decision-record addendum, plan mirror.

### Remaining

- User-run ops (documented in the runbook checklist): STS orphan-recreate,
  engine rollout restart (off-peak), Released-PV delete.
- Scout `bun.lock` Linux regen (unrelated, still open).

### Caveats

- The predictive alert has no production burn-in; it backtests cleanly on this
  incident (fires ~18:10) and stays silent across the prior quiet week, but watch
  the first weeks for false pages (tune the 0.6 usage guard or 2h horizon if so).
- `prConcurrentLimit: 3` slows Sunday dep-update throughput by design.
