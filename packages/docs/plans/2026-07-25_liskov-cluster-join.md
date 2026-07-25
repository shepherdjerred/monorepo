---
id: 2026-07-25-liskov-cluster-join
type: plan
status: in-progress
board: false
---

# liskov cluster join — port/adapt/skip + cutover plan

Second Talos node **liskov** (Ryzen 9950X, 128GB DDR5, 990 Pro 1TB OS +
2TB cache, SecureBoot) joins the single-node cluster as a **CI-only worker**.
Context: `logs/2026-07-25_liskov-build-talos-prep.md` (hardware status,
schematic `d953d04c…`, SecureBoot decision),
`logs/2026-07-18_ci-node-purchase-sanity-check.md` (justification),
`plans/2026-07-22_ci-capacity-remediation.md` (R2 option; Tracks 1–3
compose with this).

Isolation model: taint `ci=only:NoSchedule` declared in liskov's machine
config (present from first boot). Prod never tolerates it; CI pods get
toleration + nodeSelector. Control plane stays on torvalds (accepted:
torvalds down ⇒ CI down; the isolation is one-directional by design).

## Port / adapt / skip — Talos machine config

| Item                                                                                                   | Decision  | Notes                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `podPidsLimit: 4096`, eviction 4/8Gi, `enforceNodeAllocatable` + cgroup paths (`patches/kubelet.yaml`) | **Port**  | CI fork-storm armor; liskov is the target workload                                                                                                                                                                                                   |
| `kptr_restrict=1`, `panic_on_rcu_stall=1` (`patches/sysctls.yaml`)                                     | **Port**  | alloy eBPF profiler + freeze signal                                                                                                                                                                                                                  |
| `lockdown=integrity` kernel args                                                                       | Done      | baked into schematic `d953d04c…`                                                                                                                                                                                                                     |
| ZFS ARC cap + `systemReserved`                                                                         | **Adapt** | start ARC max 16Gi / min 8Gi, `systemReserved.memory: 32Gi` (ZFS slab peaked 30Gi _under CI_ on torvalds — that workload moves here), `systemReserved.cpu: 2`, `kubeReserved: 4Gi/1` (no etcd/apiserver). Right-size after 1 week of Prometheus data |
| Watchdog (`patches/watchdog.yaml`)                                                                     | **Adapt** | `iTCO_wdt` is Intel; AMD B650 = `sp5100_tco`. Verify module + `/dev/watchdog0` live before arming (`nowayout=1` + unpetted = boot loop)                                                                                                              |
| RAPL sysfs power caps (`patches/image.yaml`)                                                           | **Skip**  | Intel-only; 105W eco set in BIOS is the AMD equivalent                                                                                                                                                                                               |
| `i915` module, `processor.max_cstate=2`, `zfs_arc_meta_balance=750`                                    | **Skip**  | media-server tuning                                                                                                                                                                                                                                  |
| `interface.yaml`/`dns.yaml`/`certsans.yaml`                                                            | **Adapt** | liskov's own network config                                                                                                                                                                                                                          |
| Tailscale `ExtensionServiceConfig`                                                                     | **Adapt** | per-node auth key (real file gitignored; `tailscale.example.yaml` is the template)                                                                                                                                                                   |
| Install `diskSelector`                                                                                 | **Adapt** | by serial of the 1TB 990 Pro (read via `talosctl disks --insecure` in maintenance mode); `wipe: true` + serial selection protects the 2TB cache disk                                                                                                 |
| Taint                                                                                                  | **New**   | `ci=only:NoSchedule` via machine config `nodeTaints`                                                                                                                                                                                                 |

## Port / adapt / skip — K8s workloads (inventory 2026-07-25, agent-swept)

**Port — add toleration for `ci=only` (all currently have none, so they'd
silently skip liskov):**

| Workload                             | Where                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| alloy eBPF profiler (daemonset mode) | `argo-applications/alloy.ts:83-88`                                                 |
| prometheus-node-exporter             | `argo-applications/prometheus.ts:318-343` (chart `tolerations`)                    |
| smartctl-collector                   | `monitoring/smartctl.ts:36`                                                        |
| nvme-metrics-collector               | `monitoring/nvme-metrics.ts:47`                                                    |
| zfs-zpool + zfs-snapshots collectors | `monitoring/zfs-zpool.ts:47`, `monitoring/zfs-snapshots.ts:47` (liskov has a pool) |
| node-feature-discovery               | `argo-applications/nfd.ts:6-26`                                                    |
| openebs zfsNode plugin               | `argo-applications/openebs.ts:29-40` (needed for liskov PVCs)                      |

**Skip (Intel/torvalds-bound; verify they stay off liskov):**

- cpu-power-cap — already nodeSelector-pinned to torvalds (`cpu-power-cap.ts:42,118-122`); AMD lacks `intel-rapl:0`.
- Intel GPU device plugin — NFD-gated, won't match AMD (`intel-gpu-device-plugin.ts`).
- All i915 media/game pods (plex/jellyfin/streambot/mario-kart/pokemon), zwave-js-ui (USB on torvalds) — no toleration ⇒ can't land on liskov anyway.

**Adapt:**

| Item                         | Where                                                     | Change                                                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buildkite step-pod placement | `argo-applications/buildkite.ts:150-199` `pod-spec-patch` | add toleration `ci=only` + nodeSelector `kubernetes.io/hostname: liskov`                                                                                                                                                                                                            |
| Buildkite git-mirrors PVC    | `buildkite.ts:91-98`                                      | zfs PVCs are node-local; the existing PVC is bound on torvalds — must be recreated on liskov at cutover or CI pods wedge on volume affinity                                                                                                                                         |
| Kueue quota                  | `resources/kueue-config.ts`                               | raise once CI is liskov-only: propose cpu `24`, memory `80Gi`, pods = `BUILDKITE_MAX_IN_FLIGHT` (keep 20 initially; lockstep test enforced), eph-storage headroom re-check                                                                                                          |
| Storage classes              | `misc/storage-classes.ts:22-72`                           | create liskov ZFS pool on the 2TB drive **named `zfspv-pool-nvme`** (same as torvalds) so `zfs-ssd`/`zfs-ssd-lz4` work unchanged; taints+WaitForFirstConsumer handle placement. CI cache PVCs (bun cache, buildkitd from remediation Track 3) provision on liskov via pod placement |
| CPU alert thresholds         | `rules/resource-monitoring.ts:20-38`                      | `HighCPUUsageSustained`/`VeryHighCPUUsage` will chronically fire on a saturated CI node — exclude liskov instance or raise per-node                                                                                                                                                 |
| CPU temp alerts              | `rules/resource-monitoring.ts:260-289`                    | `coretemp` is Intel-only ⇒ silently never fires on liskov; add `k10temp` variant                                                                                                                                                                                                    |
| NVMe temp alerts             | `rules/nvme.ts:118-151`                                   | thresholds hardcode Samsung 990 PRO (65/70°C) — liskov's drives are also 990 Pros, so likely fine; confirm annotations not torvalds-specific                                                                                                                                        |
| ZFS byte-thresholds          | `rules/zfs.ts:189-196` etc.                               | tuned to torvalds' 16Gi ARC; liskov starts at same ARC size ⇒ port unchanged, review after soak                                                                                                                                                                                     |
| MemoryLeakSuspected          | `rules/resource-monitoring.ts:83-84`                      | CI churn may false-positive on liskov; watch, exclude if noisy                                                                                                                                                                                                                      |
| Velero                       | `velero.ts:90-124`                                        | no change needed: backups are opt-in by label and CI caches are disposable — just never label liskov PVCs. R2 prefixes stay `torvalds/…` (cluster-global in practice; renaming breaks continuity)                                                                                   |

## Phases (simplified 2026-07-25 — one join PR, one runbook, one later PR)

Scope trims agreed with user: **defer the Kueue quota raise** (CI runs at
today's 12CPU/20Gi from liskov day one; raise later, informed by soak, so it
also can't race `plans/2026-07-22_ci-capacity-remediation-impl.md`); **skip
the NFD toleration** (its only consumer is the Intel-GPU rule — useless on
liskov); **skip ZFS alert re-tuning** (liskov starts at the same 16Gi ARC).
Standalone-agent architecture (non-K8s CI box) considered and **rejected**
(would re-replatform the 3-week-old agent-stack-k8s pipeline).

**Phase 0 — hardware acceptance (user, in progress):** memtest86 ×4 and
TM5/Karhu on the 4-DIMM config inside the eBay return window; BIOS 105W eco
mode and fan curves; NanoKVM.

**Phase 1 — the join PR (single draft PR; merge only on join day once the
node is Ready + pool exists; rollback = revert):** monitoring DaemonSet +
openebs-zfsNode tolerations, k10temp alert variant, CI-node CPU-alert
exclusions, buildkite `pod-spec-patch` toleration+nodeSelector, liskov
Talos patch files under `src/talos/` (kubelet/zfs/sysctls/watchdog-sp5100/
taint/image), AGENTS.md single-node-section update, docs. The git-mirrors
PVC recreation is a join-day kubectl step (PVC is immutable), documented in
the runbook.

**Phase 2 — join day (manual runbook, after Phase 0 passes):**

1. Boot SecureBoot ISO (keys: ASUS setup mode → auto-enroll), maintenance mode.
2. `talosctl disks --insecure` → 1TB serial into liskov config; generate
   worker config from cluster secrets bundle; apply.
3. Verify: node Ready + taint present; `sp5100_tco` watchdog live-verify
   then arm; tailscale up.
4. Create `zfspv-pool-nvme` on the 2TB drive; verify openebs zfsNode runs.
5. Merge the Phase 1 PR; recreate git-mirrors PVC on liskov; watch first
   builds land there.
6. Confirm monitoring (node-exporter/alloy/smartctl/nvme/zfs collectors on
   liskov; Grafana node dashboards show both nodes).

**Phase 3 — torvalds relaxation + Kueue raise (separate PR, after ≥1 week
quiet canaries — `ZfsArcHitRateLow`, node MemAvailable, zero evictions):**
`systemReserved.memory` 40Gi → ~24Gi (slab pressure left with CI); Kueue
quota raise sized from real liskov soak data; keep watchdog/pids/eviction
armor; optionally revisit RAPL PL1.

## Open items

- [ ] Phase 1 join PR (worktree `liskov-join`; git-spice; **draft until join
      day** — merging early strands CI pods Pending on the nodeSelector)
- [ ] Phase 2 runbook execution — the operator runbook lives at
      `packages/homelab/src/talos/liskov/README.md` (needs booted node:
      disk serial, cluster secrets bundle, tailscale auth key)
- [ ] Phase 3 relaxation + quota PR (post-soak)

## Implementation notes (Phase 1, 2026-07-25)

- Shared contract in `src/cdk8s/src/misc/nodes.ts` (hostname, taint
  key/value, toleration in both raw-k8s and cdk8s-plus forms).
- Tolerations added: smartctl, nvme-metrics, zfs-zpool, zfs-snapshots
  (cdk8s-plus `scheduling.tolerate`), alloy (`controller.tolerations`),
  node-exporter (`prometheus-node-exporter.tolerations`), openebs zfsNode.
- Buildkite `pod-spec-patch`: toleration + `nodeSelector` on liskov.
- Alerts: `HighCPUUsageSustained`/`VeryHighCPUUsage` exclude the CI node via
  the `node` label; new `HighCPUTemperatureAmd`/`CriticalCPUTemperatureAmd`
  join `node_hwmon_chip_names{chip_name=~".*k10temp.*"}` (the k10temp `chip`
  label is a bare PCI address — a chip-label regex can never match);
  `HighSystemTemperature` now excludes k10temp sensors (Ryzen boosts Tctl
  toward 95°C TjMax by design). Temperature group extracted to its own
  function (max-lines-per-function).
- Talos: `src/talos/liskov/` (schematic, install pin + taint + ZFS sysfs,
  kubelet 32Gi/4Gi reservations, sysctls, sp5100_tco watchdog with
  verify-before-arm warning, runbook README). `update-image-id.ts`
  generalized to a NODES list — `check:talos` now validates both pins.
  Renovate regex manager covers the liskov image file.
- `packages/homelab/AGENTS.md`: "Single-Node Cluster" section replaced with
  two-node topology contract.
