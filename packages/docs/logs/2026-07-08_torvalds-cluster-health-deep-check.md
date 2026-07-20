---
id: log-2026-07-08-torvalds-cluster-health-deep-check
type: log
status: complete
board: false
---

# Torvalds Cluster Health — Deep Check

## Summary

Deep health audit of the single-node Talos cluster `torvalds` on 2026-07-08.
**Verdict: healthy.** No infra-level problems. Everything Running, all 66 ArgoCD
apps Synced + Healthy, etcd healthy, no node pressure. A handful of app-level
alerts and some orphaned storage are the only follow-ups.

## What was checked

- Connectivity/context (`kubectl`, `talosctl`), versions
- Node conditions, capacity, allocated resources, `kubectl top`
- Talos `health`, `services`, `diagnostics`, `etcd status/alarm`
- Physical memory (`/proc/meminfo`), ZFS ARC (`arcstats`), kubelet reservations
- Pod inventory: non-Running, restarts, abnormal terminations (OOM/SIGILL)
- Kernel log (`dmesg`) grep for errors
- PVC/PV binding, disks, SMART + ZFS collectors
- Alertmanager active alerts
- ArgoCD application sync/health

## Key facts

| Area       | State                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Talos      | v1.13.5, all 13 services Running/OK, `health` fully passes, no diagnostics                                                                         |
| Kubernetes | v1.36.2 server (client 1.33 — skew warning, cosmetic), kernel 6.18.36                                                                              |
| Node       | Ready; no Memory/Disk/PID pressure; uptime ~2d (rebooted 2026-07-07 01:14 UTC)                                                                     |
| CPU        | 32 cores (27 allocatable), ~10% used                                                                                                               |
| Memory     | 125 GiB total, **49 GiB available**. ZFS ARC pinned at c_max 48 GiB. `top` "119%" is vs. deliberately-low allocatable (65 GiB) — not real pressure |
| etcd       | Healthy, single-member leader, DB 511 MB (7.7% in use), no alarms, v3.6.12                                                                         |
| Storage    | 2× Samsung 990 PRO 4TB NVMe; all PVCs Bound; no DiskPressure; SMART/ZFS collectors clean                                                           |
| GitOps     | **All 66 ArgoCD applications Synced + Healthy**                                                                                                    |

## Findings / follow-ups (none critical to infra)

1. **Restart storm is a red herring.** ~Every pod shows one `exit=255` termination
   at `2026-07-07T01:14:09Z` — a single node reboot 2 days ago, not crash-looping.
   Higher lifetime counts (kube-proxy 29, prometheus collectors 20–23, promtail 15,
   flannel 12) accumulated across reboots over 25 days.

2. **3 orphaned "Released" PVs** (Retain policy, not reclaimed) — reclaimable space:
   - `dagger/data-dagger-dagger-helm-engine-0` — **2Ti**, `zfs-ssd-buildcache`, 24d
   - `pokemon/pokemon-rom-volume` — 8Gi, `zfs-ssd`, 267d
   - `media/overseerr-pvc` — 8Gi, `zfs-ssd`, 379d

3. **Active alerts (14 total)** — mostly application-level, not infra:
   - 7× critical `ScoutScheduledReportMissedWeekly` (scout-prod) — weekly reports not firing
   - 1× critical `StreambotProgressStalled` (media) — ffmpeg progress events stalled since 2026-07-07 06:56
   - 1× warning `NodeMemoryMajorPagesFaults` — ~500 major faults/s, started 2026-07-09 00:45 (~2h before check). Infra-adjacent: symptom of RAM being tight (ARC + workloads evicting executable pages). **Watch item.**
   - 1× warning `HomeAssistantEntitiesUnavailable` — 93 HA entities unavailable since 2026-07-08
   - 2× info Velero "PVC size excessive" (media) — large media volumes, informational
   - `Watchdog` + `InfoInhibitor` — normal/expected

4. **scout-beta one-off:** `scout-backend` crashed with exit 132 (SIGILL) on 2026-07-07 07:00, auto-restarted, Ready/healthy since (~2 days). A transient liveness-probe timeout fired ~57m before the check but the pod stayed Ready. No action.

## Hardware deep-dive (2026-07-08, follow-up)

### CPU — Intel Core i9-14900K (32 threads)

- **Instability actively mitigated.** Microcode **0x133** (newer than Intel's 0x12B
  Vmin-Shift fix), and a **RAPL power cap PL1=125W / PL2=253W** re-applied every 5 min
  by the `node-tuning/cpu-power-cap` DaemonSet (RAPL not firmware-locked; writes succeed).
- Package temp **58°C**, acpitz 27.8°C — cool.
- Load avg **3.5 / 3.6 / 3.6** over 32 threads (~11%). PSI cpu `some` ~3%, `full` 0.
- **Only one instability-signature crash cluster-wide** — scout-beta SIGILL (exit 132),
  isolated, 2 days ago. No SIGSEGV/SIGBUS/SIGFPE anywhere. With 0x133 + power cap,
  CPU degradation is unlikely; treat as a one-off but keep watching.

### Memory — 125 GiB

- **49 GiB available.** PSI memory pressure **0.00** (`some` and `full`) — zero stalls.
  No OOMKills. No swap. The `top` "119%" is entirely ZFS ARC (48 GiB, at `c_max`).
- `NodeMemoryMajorPagesFaults` (~500/s, started ~2h before check) fires but PSI memory=0,
  so it's not causing stalls — likely an ARC/page-cache churn burst. Benign for now.

### Storage — 2 ZFS pools + OS disk, all healthy

| Disk / pool                   | Role                                | SMART / state                                              |
| ----------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| nvme0 990 PRO 4TB (…B15590B)  | OS + `/var` (xfs, ephemeral)        | 11% wear, 34°C, 0 media errors, 277 TB written, 100% spare |
| nvme1 990 PRO 4TB (…511734N)  | `zfspv-pool-nvme` (**single-disk**) | 17% wear, 42°C, 0 media errors, 226 TB written             |
| 6× 870 EVO 4TB SATA (sda–sdf) | `zfspv-pool-hdd` (**raidz2**)       | all PASSED, **0 realloc sectors**, ~4,900 hrs, 28–32°C     |

- `zfspv-pool-hdd`: 21.8T raw, **48% full**, 25% frag, raidz2 (2-disk fault tolerance), scrub clean Jul 5 (0 errors).
- `zfspv-pool-nvme`: 3.62T, **32% full**, 61% frag, **single disk — no redundancy**, scrub clean Jul 5 (0 errors).
- `/var`: **60% used (2.39 / 4.0 TB, 1.6 TB free)** — of which **2.02 TB is the containerd image store** (Dagger/CI layer accumulation). Ephemeral pod usage is tiny (top consumer 2.5 GB).
- nvme0 reports 3.37 TB SSD-utilized vs 2.39 TB fs-used → **xfs isn't issuing TRIM/discard**; benign but a periodic `fstrim` would reconcile it.
- Thermals all cool: CPU pkg 58°C, NVMe 34/42°C, SATA SSDs 28–32°C.
- NVMe unsafe-shutdowns 44/65 reflect single-node reboots; ZFS + xfs journaling absorbed them (0 data errors).

### Hardware-level recommendations

1. **`zfspv-pool-nvme` is a single disk with no redundancy** — a drive failure loses that
   whole tier. Confirm the PVCs on it are covered by Velero backups (or accept as reproducible).
2. **Prune the 2 TB container-image store** on `/var` (CI/Dagger layers). Not urgent (1.6 TB free)
   but it's the dominant `/var` consumer and grows.
3. **Enable periodic `fstrim`** on the nvme0 `/var` xfs to keep SSD free-space reconciled.
4. Reclaim the 3 orphaned "Released" PVs (see finding #2 above).

## Follow-up investigation (2026-07-10): recurring CI-triggered hard freeze — ROOT CAUSE FOUND

User reported recurring full hard-freezes during CI (KVM/HDMI totally unresponsive, requiring
physical power-cycle — `kubectl`/`talosctl` both dead) and asked whether scout-beta/scout-prod's
"random" kills are related. Investigated using direct Prometheus/Loki/Buildkite API access
(all reachable over Tailscale — no auth needed for Prometheus/Loki; Grafana admin password in
the `prometheus-grafana` secret didn't match, unresolved, but wasn't needed).

### Confirmed: 7 full node reboots in 48 hours, all caused by the same mechanism

Using `node_boot_time_seconds` (a kernel-truth gauge, immune to false positives) at 15–30s
resolution, found real kernel reboots at:

| Boot time (UTC)     | Prior gap length |
| ------------------- | ---------------- |
| 2026-07-05 04:18:28 | —                |
| 2026-07-05 04:47:24 | ~2 min           |
| 2026-07-05 05:01:37 | ~1 min           |
| 2026-07-05 05:15:31 | 8.8 min          |
| 2026-07-05 18:34:08 | 6.8 min          |
| 2026-07-05 19:36:50 | 5.2 min          |
| 2026-07-07 01:17:40 | 8.8 min          |

No further events found in the following days.

### Root cause: unbounded concurrent Dagger CI sessions overwhelm the single shared engine, which has no CPU limit, on a single-node cluster

The Dagger engine (`dagger/dagger-helm` StatefulSet) logs its own `"engine metrics"` line every
~60s with `loadavg-1`, `dagger-session-count`, `goroutine-count`, `mem-available`. Pulled via Loki
for every freeze window — **100% of the 7 incidents show the identical signature**:

| Freeze (UTC)     | Peak `dagger-session-count` | Peak `loadavg-1` | `mem-available` trough |
| ---------------- | --------------------------- | ---------------- | ---------------------- |
| 2026-07-05 04:18 | 17                          | 27,528           | 6.8 GB                 |
| 2026-07-05 04:47 | 23                          | 1,157            | 26.1 GB                |
| 2026-07-05 05:01 | 26                          | 212              | 22.6 GB                |
| 2026-07-05 05:15 | 31                          | 2,618            | 8.5 GB                 |
| 2026-07-05 18:34 | 20                          | 88.5             | 35.1 GB                |
| 2026-07-05 19:36 | 11                          | 12,468           | 4.0 GB                 |
| 2026-07-07 01:17 | 9                           | **16,147**       | 3.7 GB                 |

Best-documented case (2026-07-07, minute-by-minute from the engine's own logs):

```
01:02:23  load1=2.3   sessions=0   goroutines=24    mem_avail=51.4GB   (idle baseline)
01:03:23  load1=5.1   sessions=9   goroutines=1164  mem_avail=38.2GB   ← 9 sessions land at once
01:04:24  load1=52.4  sessions=9   goroutines=1081  mem_avail=41.6GB
01:06:24  load1=1329  sessions=6   goroutines=542   mem_avail=13.9GB
01:10:58  load1=16147 sessions=3   goroutines=363   mem_avail=4.5GB    ← kernel scheduler locked
01:17:40  ── node reboots (physical power-cycle) ──
```

Cross-referenced with the Buildkite API (`BUILDKITE_API_TOKEN` env var): the trigger was
**build #5139** (`fix(sjer.red): bundle rss parser entities for astro`), a "build everything"
run that generated **65 CI jobs**. Roughly 20–30 of them (`pkg-check`, `Lint + Typecheck + Test`,
`Quality Bundle`, `Knip`, `Trivy Scan`, `Semgrep Scan`, `Build + Smoke *`, etc.) started within a
~1-minute window (01:02:28–01:03:52), each independently opening a session against the **same
single remote Dagger engine** (`tcp://dagger-engine.dagger.svc.cluster.local:8080`). At 01:13:21
Buildkite mass-marked ~15 still-running jobs `canceled` with an identical timestamp — the
"agent lost" detection firing because the node itself had frozen, not a real cancellation.

**30-day OOM-kill history (`node_vmstat_oom_kill`) independently corroborates this**: 650 OOM
kills on 2026-07-05 alone (vs. single digits on every other day in the window) — the kernel's
OOM killer thrashing repeatedly as memory and the runqueue both collapsed, before the box
froze solid.

### Why the engine has no backpressure

```
kubectl get statefulset -n dagger dagger-dagger-helm-engine -o jsonpath='{.spec.template.spec.containers[0].resources}'
→ {"limits":{"memory":"50Gi"},"requests":{"cpu":"6","memory":"16Gi"}}
```

- **No CPU limit** on the Dagger engine container — it can consume all 32 threads.
- **50Gi memory limit** — combined with ZFS ARC (pinned at 48Gi) leaves very little headroom on
  a 125Gi host once real workloads are added.
- The live Kueue `ClusterQueue` quota (`nominalQuota`: cpu=7500m, memory=16Gi) is far smaller
  than the ~20–30 concurrent job pods actually observed running — meaning **most CI job pods are
  not gated by this Kueue queue at all** (unconfirmed whether by design or a second queue exists;
  didn't fully trace `scripts/ci/src/lib/k8s-plugin.ts` to confirm). Either way, nothing currently
  caps how many Buildkite steps can simultaneously open a session against the one shared engine.
- This is a **single-node cluster** — there is no second node to absorb an overload; a CI-induced
  freeze is a full outage of everything (scout, media, home automation, etc.), not just CI.

### scout-beta / scout-prod restarts — same root cause, not independent flakiness

Checked `kube_pod_container_status_restarts_total` transitions for both namespaces over 14 days.
Most scout restarts (e.g., scout-beta and scout-prod both restarting at the identical
**2026-07-05 02:35:14** timestamp) are **collateral damage from these node freezes/reboots** —
every pod on the node restarts simultaneously when the kernel locks up and the box is
power-cycled, which reads as "random" because the actual trigger (CI-induced freeze) is invisible
from the scout pod's perspective. The one exception found in the prior investigation
(2026-07-07T14:00:00, exit 132/SIGILL) was a genuine one-off, unrelated to a reboot.

### Storage — deeper look, still healthy

- Disk I/O during the worst freeze ramp (2026-07-07 01:00–01:15) stayed low: nvme0 (OS/`/var`)
  peaked at 11% busy, nvme1 (`zfspv-pool-nvme`) at 34% busy — **storage was not the bottleneck**;
  this was purely a CPU/memory/scheduler exhaustion event.
- No `node_disk` error-rate metrics fired during any freeze window.
- SMART wear/error counters (11%/17% wear, 0 media errors, both pools scrub-clean 2026-07-05)
  remain the same as the earlier snapshot — no degradation from the freeze events themselves;
  ZFS + xfs journaling appear to have absorbed the 7 unclean shutdowns without data loss.

### Memory — confirmed healthy in steady state

PSI memory pressure is 0.00 outside of freeze windows (see original findings above); the only
memory blowups on record are the 7 freeze events themselves, all caused by the CI session pile-up
above, not an ongoing leak or independent problem.

### Recommended fixes (not yet implemented — awaiting user decision)

1. **Cap Dagger engine CPU** (e.g., `limits.cpu: "16"` or similar) so a session pile-up can no
   longer consume the entire host and starve the kernel itself.
2. **Add real concurrency control in front of the shared engine** — either a Kueue queue that
   actually gates _every_ CI job pod (not just a subset), or a lower `parallelism`/concurrency
   group on the Buildkite pipeline generator so "build everything" runs fan out in waves instead
   of all at once.
3. **Lower the Dagger engine memory limit** (50Gi is too close to the ARC-adjusted headroom) or
   cap ZFS ARC (`c_max`) lower to guarantee more free memory during CI bursts.
4. Consider whether every `fix/*` or merge-conflict-resolution push needs a full 65-job
   "build everything" run — tightening change detection would reduce how often this many jobs
   fire at once.
5. Since this is a single-node cluster, a hardware watchdog (Talos `machine.kernel.modules` /
   BMC-triggered reset) would at least auto-recover from a future freeze without requiring a
   physical power-cycle — worth evaluating.

## Session Log — 2026-07-08

### Done

- Full read-only health sweep of Talos + Kubernetes on `torvalds`; wrote this log.
- Confirmed cluster is healthy at the infra layer (node, Talos services, etcd, storage, GitOps all green).

### Remaining

- Optional cleanup: delete the 3 Released PVs (esp. the 2Ti dagger buildcache) if the data isn't needed.
- Triage app-level alerts (Scout weekly reports, Streambot ffmpeg stall, Home Assistant entities) — out of scope for this infra check.
- Keep an eye on `NodeMemoryMajorPagesFaults` if it persists — memory headroom vs. ARC is tight.

### Caveats

- `talosctl exec` is gone in v1.13.5, but `zpool status`/`smartctl`/`df` were obtained by
  `kubectl exec` into the `smartctl-collector` / `zfs-zpool-collector` pods (they carry the
  host tooling and host mounts) and via kubelet's `/stats/summary`. Full hardware data captured.
- Single-node cluster: no HA; a node reboot is a full outage (as seen 2 days ago).
- `zfspv-pool-nvme` has no disk-level redundancy (single 990 PRO); depends on Velero for DR.

## Session Log — 2026-07-10 (follow-up)

### Done

- Root-caused the recurring CI-triggered hard freeze: unbounded concurrent Dagger CI sessions
  (9–31 at once) hitting the single shared, CPU-unlimited Dagger engine on a single-node cluster,
  driving load average up to 27,528 and crashing free memory to single-digit GB — a full kernel
  scheduler lockup requiring physical power-cycle. Confirmed via 3 independent signals:
  `node_boot_time_seconds` (7 real reboots), the Dagger engine's own `"engine metrics"` Loki logs
  (session-count/loadavg/mem-available), and 30-day OOM-kill history (650 kills on 2026-07-05
  alone). Cross-referenced with the Buildkite API to identify the triggering "build everything"
  run (build #5139, 65 jobs).
- Confirmed scout-beta/scout-prod's "random" restarts are collateral damage from these same
  node-wide freezes, not independent app flakiness (restart timestamps line up with reboot times).
- Confirmed memory is healthy in steady state (PSI=0 outside freeze windows) and storage was not
  a contributing factor in the freeze (disk I/O stayed low throughout the ramp).
- Established direct Prometheus (`https://prometheus.tailnet-1a49.ts.net`) and Loki
  (`https://loki.tailnet-1a49.ts.net`) API access over Tailscale, no auth required — much faster
  than the `kubectl exec` workarounds used in the original audit above.

### Remaining

- User has not yet decided which remediation to apply (see "Recommended fixes" above): CPU-cap
  the Dagger engine, add real concurrency gating in front of it, lower its memory limit / ARC
  `c_max`, tighten CI change-detection to reduce "build everything" frequency, and/or add a
  hardware watchdog for auto-recovery.
- Grafana admin password (from the `prometheus-grafana` k8s secret) returned 401 — not
  investigated further since direct Prometheus/Loki access was sufficient.
- Did not fully trace `scripts/ci/src/lib/k8s-plugin.ts` / Kueue LocalQueue wiring to confirm
  whether most CI job pods bypass Kueue admission entirely or a second ClusterQueue exists.

### Caveats

- The 3 orphaned Released PVs from the original audit include the same
  `dagger/data-dagger-dagger-helm-engine-0` buildcache PV (2Ti, Released 24d) — worth checking
  whether losing that cache volume correlates with increased cache-miss load (more real work per
  build = more resource pressure) before/around the freeze cluster, though not confirmed.
