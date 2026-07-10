# torvalds CI freeze — investigation handoff (facts only)

## Status

In Progress — data-gathering only. No runtime, cluster, or code changes made. No root cause
established.

This document records **only directly-observed facts** (tool output, file contents, git
history, API results) with sources. It deliberately contains **no diagnosis, no root-cause
claim, and no recommended fix.** Correlations are stated as timestamps + values, not causes.
An "Open questions" section lists what is unverified.

---

## 1. Symptom (observed)

- Cluster context: `admin@torvalds`. Single node named `torvalds`, Tailscale IP `100.102.88.88`.
- Multiple times during this session, `torvalds:6443` (kube-apiserver) returned
  `connection refused` or `i/o timeout` while, at the same time:
  - `ping torvalds` succeeded (0% loss).
  - `talosctl -n torvalds` sometimes responded and sometimes returned
    `dial tcp 100.102.88.88:50000: i/o timeout` (Talos apid on :50000 was itself
    intermittently unresponsive during the worst moments).
- When kube API was reachable, `kubectl get node torvalds` showed: `Ready`,
  role `control-plane`, `v1.36.2`, age `411d`; conditions `MemoryPressure=False`,
  `DiskPressure=False`, `PIDPressure=False`, `Ready=True`.
- `changes(node_boot_time_seconds[24h])` = **4** (4 boot-time changes in 24h at query time).
- Kernel boot line (talosctl dmesg): `Linux version 6.18.34-talos`, timestamp
  `2026-07-05T04:47:24Z`.
- Pod `dagger-dagger-helm-engine-0`: `restartCount=3`, last terminated
  `reason=Unknown, exitCode=255`.
- `kubectl get events` `reason=Rebooted` present (multiple boot IDs).

### User-reported (not independently measured)

- User states the manual reboots are performed by them to recover the node.
- User states the most recent freeze occurred while **only one build** was running.
- User states these freezes "weren't happening before."
- User states the Dagger cache was cleared recently, and that clearing it has been
  done before without this result.

---

## 2. Live measurements via Talos API during a freeze (this session)

Single `talosctl -n torvalds read ...` samples taken while kube API was down:

| Source                                                         | Value                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `/proc/meminfo` MemTotal                                       | 131473032 kB (~125 GiB)                                    |
| `/proc/meminfo` MemFree                                        | **2414340 kB (~2.4 GB)**                                   |
| `/proc/meminfo` MemAvailable                                   | ~21 GB (21271088 kB)                                       |
| `/proc/spl/kstat/zfs/arcstats` size                            | 180544832 (~0.18 GB) at one read; 11.2 GB at a later read  |
| arcstats c_max                                                 | 67108864000 (62.5 GiB)                                     |
| `/proc/pressure/io`                                            | `some avg60=9.73` / `full avg60=5.08`                      |
| `/proc/pressure/memory`, `/proc/loadavg`, `/proc/pressure/cpu` | not captured — reads returned `i/o timeout` at that moment |

Talos `services`: `etcd`, `kubelet`, `apid` each showed `Running/OK` with `LAST CHANGE`
25s–1m before the query (i.e., had recently restarted). `MachineStatus` observed once as
`STAGE=running, READY=false`.

---

## 3. Prometheus/Grafana data

Datasource: kube-prometheus-stack; Grafana at `https://grafana.tailnet-1a49.ts.net`
(intermittently `http=200` and, during freezes, unreachable). Prometheus + Grafana run
**on `torvalds`** (namespace `prometheus`; node-exporter pod
`prometheus-prometheus-node-exporter-*`).

### 3a. Reboot / unresponsive windows (scrape gaps >3 min in `node_memory_MemFree_bytes`)

Window 2026-07-04 18:19 → 2026-07-05 07:19 UTC:

| Down (last sample) | Back  | Gap    |
| ------------------ | ----- | ------ |
| 07-05 02:09        | 02:34 | 25 min |
| 07-05 03:40        | 04:22 | 42 min |
| 07-05 04:44        | 04:51 | 7 min  |
| 07-05 04:58        | 05:19 | 21 min |

In that window: `IO PSI` (rate of `node_pressure_io_stalled_seconds_total`) max **30.3%**;
`MEM PSI` max **4.6%**; `MemFree` min **1.01 GB**.

### 3b. Lead-up into the 03:40 UTC gap (Prometheus, per-sample)

`daggerWS` = `max(container_memory_working_set_bytes{namespace="dagger"})`;
`CIpods` = `count(kube_pod_info{namespace="buildkite"})`.

| time (UTC)  | MemFree GB | ARC GB | daggerWS GB | CPU% | IOpsi% | MEMpsi% | CIpods |
| ----------- | ---------- | ------ | ----------- | ---- | ------ | ------- | ------ |
| 03:05–03:28 | ~63        | ~17    | ~1.0        | ~9   | 0.5    | 0.0     | 1      |
| 03:29       | 57.8       | 17.5   | 1.6         | 12   | 0.8    | 0.0     | 41     |
| 03:30       | 33.9       | 22.2   | 9.7         | 19   | 0.7    | 0.0     | 41     |
| 03:31       | 4.0        | 42.2   | 9.9         | 64   | 0.9    | 0.3     | 40     |
| 03:32       | 41.4       | 16.4   | 8.4         | 90   | 1.1    | 1.4     | 23     |
| 03:35       | 33.9       | 33.9   | 4.5         | 45   | 2.7    | 0.0     | 50     |
| 03:38       | 31.1       | 45.6   | 5.7         | 20   | 4.2    | 0.0     | 66     |
| 03:39       | 2.2        | 60.0   | 6.4         | 40   | 2.8    | 0.1     | 63     |
| 03:40       | 1.1        | 12.1   | 5.4         | 88   | 1.7    | 8.7     | 63     |
| 03:41       | 1.1        | 12.1   | 5.4         | 97   | 1.5    | 11.5    | 63     |

`03:41` is the last sample before the scrape gap. ARC value oscillated within the window
(observed sequence incl. 17 → 42 → 53 → 16 → 60 → 12 GB).

### 3c. Retained continuous window 06:17 → 18:17 UTC (no scrape gaps)

- 06:17–10:20: `MemFree` min per-minute ranged **1.0–3.1 GB**; `IO PSI` and `MEM PSI`
  hourly max ~0 (MEM PSI ≤0.2%, IO PSI ≤1.0%); `CIpods` = `—` (metric absent) across
  this window except `1` at 18:00.
- 10:22 onward: `MemFree` recovered to 11–13 GB, then declined to ~7.7 GB by 18:00 as
  `node_zfs_arc_size` rose to 45 GB.
- Top pods by peak `container_memory_working_set` in window: `dagger/…engine-0` **11.6 GB**,
  `media/…qbittorrent…` 3.6 GB, `prometheus/…prometheus-0` 3.5 GB.
- `dagger` namespace working set: ~2 GB during 06–09h, ~0.7–0.8 GB during 10–18h.

---

## 4. Configuration (verified first-hand this session, file:line)

| Setting                                     | Value                                                         | Source                                                               |
| ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `zfs_arc_max`                               | `67108864000` (62.5 GiB)                                      | `packages/homelab/src/talos/patches/image.yaml:25`, `.../zfs.yaml:9` |
| `zfs_arc_min`                               | `8589934592` (8 GiB)                                          | `.../zfs.yaml:10`                                                    |
| kubelet `system-reserved`                   | `cpu=2,memory=52Gi`                                           | `packages/homelab/src/talos/patches/kubelet.yaml:5`                  |
| kubelet `kube-reserved`                     | `cpu=1,memory=2Gi`                                            | `kubelet.yaml:6`                                                     |
| kubelet `eviction-hard`                     | `memory.available<2Gi,nodefs.available<10%`                   | `kubelet.yaml:7`                                                     |
| kubelet `eviction-soft`                     | `memory.available<4Gi,nodefs.available<15%` (grace 2m)        | `kubelet.yaml:8-9`                                                   |
| Dagger engine requests                      | `cpu: 6, memory: 16Gi`                                        | `.../argo-applications/dagger.ts:281-282`                            |
| Dagger engine limits                        | `memory: 50Gi` (no CPU limit)                                 | `dagger.ts:285`                                                      |
| Dagger GC                                   | `maxUsedSpace 800GB, reservedSpace 200GB, minFreeSpace 400GB` | `dagger.ts:315-317`                                                  |
| Dagger cache PVC                            | `storage: 2Ti`                                                | `dagger.ts:351`                                                      |
| Buildkite `max-in-flight`                   | `24`                                                          | `.../argo-applications/buildkite.ts:116`                             |
| Kueue `buildkite` ClusterQueue nominalQuota | `cpu 7500m, memory 16Gi`                                      | `.../resources/kueue-config.ts:45-50`                                |
| CPU power cap (applied)                     | `pl1Watts: 125, pl2Watts: 253`                                | `.../cdk8s-charts/apps.ts:137`                                       |
| CPU model (comment)                         | `i9-14900K (PL1=125W, PL2=253W)`                              | `image.yaml:18`                                                      |

Notes (facts):

- `apps.ts:137` passes **125 W / 253 W**. A comment at `cpu-power-cap.ts:38` states
  "The 95 W / 140 W limits are calibrated for the i9-13900K" — inconsistent with both the
  applied values (125/253) and `image.yaml:18` (i9-14900K). The **applied** cap is 125/253.
- CI pod → Dagger delegation: `scripts/ci/src/lib/k8s-plugin.ts:74` sets
  `checkout: { skip: true }`; lines 89-90 set
  `_EXPERIMENTAL_DAGGER_RUNNER_HOST=tcp://dagger-engine.dagger.svc.cluster.local:8080`.
  CI step containers set `requests` only (default `cpu 100m / memory 256Mi`), **no `limits`**
  (`k8s-plugin.ts:81-86`). Tiers (`scripts/ci/src/catalog.ts`): HEAVY 250m/512Mi,
  MEDIUM 150m/384Mi, LIGHT 100m/256Mi.
- Dagger engine is a single `StatefulSet` reached via one ClusterIP Service (all builds
  share one engine).

---

## 5. Recent changes (git, with dates)

| Commit              | Date       | Fact                                                                                                                                                       |
| ------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8025054fc` (#1377) | 2026-07-03 | "bump all Helm charts & Docker images to latest (incl majors)". Diff includes `ARG DAGGER_VERSION=0.20.8` → `0.21.4`; 41 version bumps including talos.    |
| `35a549e17`         | 2026-06-06 | "remediate PagerDuty alert noise" — most recent commit changing `zfs_arc_max` in `zfs.yaml`; value went 48 GiB (`51539607552`) → 62.5 GiB (`67108864000`). |
| `1bd1b9ce2` (#1395) | (recent)   | "Dagger disk-full durable fixes — predictive alert, GC retune, Renovate smoothing".                                                                        |

`zfs_arc_max` git history shows prior oscillation: 62.5 GiB → 48 GiB → 62.5 GiB (the
48→62.5 raise is the most recent, in `35a549e17`).

`DAGGER_VERSION` ARG currently lives in `.buildkite/ci-image/Dockerfile` (exact current
value not re-read this session beyond the #1377 diff showing `0.21.4`).

---

## 6. PagerDuty incident history (API, ~last 180–200 days)

560 incidents total in window; ~132 matched infra/ZFS/node keywords. Counts by
normalized title (dates = first..last occurrence observed):

| Count   | Title                                                    | Date range               |
| ------- | -------------------------------------------------------- | ------------------------ |
| 69      | Memory major page faults are occurring at very high rate | 2026-01-13 .. 02-04      |
| ~20     | High ZFS hash collisions detected                        | 2025-12-30 .. 2026-01-04 |
| several | High ZFS ARC eviction rate detected                      | 2025-12-30 .. 2026-01-01 |
| 13      | Potential memory leak detected                           | 2026-01-16 .. 02-06      |
| 11      | PersistentVolume is filling up                           | 2026-01-13 .. 02-02      |
| 9       | High disk write activity detected                        | 2026-01-14 .. 01-18      |
| 7       | Velero volume snapshot failed                            | 2026-01-06 .. 02-03      |
| 7       | Large volume backup attempt failed                       | 2026-01-06 .. 02-03      |
| 4       | Sustained disk write activity - SSD wear concern         | 2026-01-14 .. 01-18      |
| 1       | Host is running out of memory                            | 2026-01-22               |
| 1       | High memory pressure detected                            | 2026-01-22               |
| 1       | Node exporter down                                       | 2026-01-25               |

Fact about the data: matched incidents cluster in **Dec 2025 – early Feb 2026**; no
keyword-matched incidents appeared between Feb and Jul in this query. Whether that reflects
alert-rule changes, resolution, or genuine absence is **not established**. Incidents queried
had no operator notes (auto-resolved).

---

## 7. Open questions (NOT established this session)

- Whether the freezes are caused by CI, by ZFS/ARC behavior, by the Dagger 0.20.8→0.21.4
  change, by the ARC 48→62.5 GiB change, by a cold cache, by something else, or a
  combination. No causal link has been proven — only the timestamped correlations in §3b.
- Why 06:17–10:20 UTC held `MemFree` at 1–3 GB with PSI ≈ 0 and no CI pods present (§3c),
  vs. the 03:40 window where low `MemFree` coincided with high MEM PSI (§3b).
- What actually consumed memory during the freeze (top-process/cgroup list could not be
  captured; `talosctl processes` returned `i/o timeout`).
- Whether the Feb–Jul absence of ZFS PD alerts is a real change or an alerting change.
- Whether a Dagger engine version bump invalidated the on-disk cache format (not verified).
- The current exact `DAGGER_VERSION` value in `.buildkite/ci-image/Dockerfile` (not re-read).
- Whether the reboots seen in metrics were all user-initiated or included any automatic
  Talos/watchdog reboot (user reports doing them manually; not independently confirmed).

---

## 8. 19:30 UTC recurrence: full host hard lock

User clarified after the recurrence that this was **not** just Kubernetes or Talos
unreachability: the KVM showed frozen HDMI output and no input was accepted.

Facts captured around the event:

- At `2026-07-05T19:35:39Z`, `kubectl --request-timeout=5s get --raw=/readyz?verbose`
  failed with a connection timeout to `torvalds:6443`.
- `ping -c 3 torvalds` had 100% packet loss.
- `tailscale status --json` showed peer `torvalds` as `online=false`,
  `lastSeen=2026-07-05T19:30:00.1Z`.
- User reported Talos commands were also not working during the freeze.
- After user rebooted the node, Talos services came back first; kube API initially refused
  `:6443`, then the node became `Ready`.
- Kernel boot line after reboot was `2026-07-05T19:36:49Z`.
- Kubernetes node events recorded a new `Rebooted` event with boot id
  `4bdb26a6-c209-43fd-994b-462a6cc1af7c`.

Prometheus samples from the lead-up (`19:20` -> `19:30` UTC):

| Metric                          | 19:20  | 19:30  | Note                                  |
| ------------------------------- | ------ | ------ | ------------------------------------- |
| Buildkite pod count             | 14     | 85     | Large CI fan-out before disappearance |
| Running Buildkite pods          | 2      | 18     | Burst of concurrent active jobs       |
| CPU usage                       | 29%    | 59%    | Spikes up to 83% in the window        |
| CPU pressure waiting            | 8.5%   | 9.4%   | Peaked at 27% at 19:23                |
| MemFree                         | 15 GB  | 14 GB  | Not a 1 GB memory cliff this time     |
| MemAvailable                    | 40 GB  | 42 GB  | Kubelet did not report pressure       |
| Memory pressure waiting/stall   | ~0%    | 0%     | Unlike earlier 03:40 UTC pattern      |
| IO pressure stalled             | 2.2%   | 0.9%   | Not high at last sample               |
| ZFS ARC size                    | 32 GB  | 48 GB  | Near live `zfs_arc_max` after reboot  |
| Dagger namespace working set    | 3.6 GB | 5.2 GB | Single shared engine still active     |
| Buildkite namespace working set | 0.6 GB | 1.6 GB | Pod count, not pod memory, dominated  |

Samples then disappear until `19:40` UTC while the node was rebooting/recovering.

Additional Dagger facts:

- Live Dagger engine pod after recovery: `registry.dagger.io/engine:v0.20.8`,
  `restartCount=6`, previous termination `exitCode=255`, `reason=Unknown`.
- CI base image source currently pins Dagger CLI `0.21.4` in
  `.buildkite/ci-image/Dockerfile`, while the homelab Dagger Helm chart version in
  `packages/homelab/src/cdk8s/src/versions.ts` is `0.20.8`.
- Post-reboot Dagger logs showed many leftover CNI network namespaces from the previous
  run, consistent with Dagger/BuildKit work being interrupted mid-flight.

Interpretation bounded by the data:

- This recurrence is a **bare-metal hard lock under CI burst load**, not a normal
  Kubernetes/Talos outage.
- It does **not** match the earlier low-memory cliff exactly: the last pre-freeze sample
  still had substantial available memory and near-zero memory PSI.
- The strongest current leads are CPU/concurrency-sensitive kernel or hardware instability
  under Dagger/BuildKit load, and the Dagger CLI/engine version split (`0.21.4` CLI vs
  `0.20.8` engine). Neither is proven causal yet.

---

## Session Log — 2026-07-05

### Done

- Captured live freeze-state samples via Talos API (§2).
- Extracted reboot/gap windows and the per-sample lead-up into the 03:40 UTC gap from
  Prometheus (§3).
- Verified node/CI/ZFS configuration values first-hand from repo files (§4).
- Collected recent relevant git changes with dates (§5).
- Pulled PagerDuty infra/ZFS incident counts (§6).
- Captured the later `19:30Z` recurrence as a full host hard lock with KVM, tailnet,
  kube, reboot-event, CI fan-out, and Prometheus evidence (§8).

### Remaining

- Establish causation (none proven). Capture a top-process/cgroup memory breakdown during a
  live freeze. Re-read current `DAGGER_VERSION`. Confirm whether reboots include any
  non-manual ones.
- Test mitigations one at a time: cap Buildkite/Dagger concurrency, align Dagger CLI and
  engine versions, and capture out-of-band hardware/firmware evidence during the next lock.

### Caveats

- No runtime, cluster, or code changes were made; this doc was updated with the recurrence
  evidence.
- Prometheus/Grafana are co-located on `torvalds`; data for full-freeze intervals is absent
  (scrape gaps), so §3b relies on samples captured up to the moment scraping stopped.
- Earlier in the session an incorrect power-cap value (95/140) was stated from a stale code
  comment; the applied value is 125/253 (`apps.ts:137`), used in this doc.
- All UTC timestamps are as reported by Prometheus/node clock.
- The `19:30Z` recurrence was observed after the first handoff section was written; its
  evidence supersedes the weaker "kube API unavailable" framing for this event.
