---
id: log-2026-06-25-homelab-nvme0-zfs-pool-suspended
type: log
status: complete
board: false
---

# Homelab outage — `zfspv-pool-nvme` suspended (nvme0 990 PRO controller death)

## Symptom (as reported)

"Check my homelab — CPU, mem, disk. HA, Grafana, Plausible seem to have issues." User had already tried
restarting pods (incl. the whole `prometheus` monitoring stack) to fix it, with no improvement.

## Root cause

The Samsung **990 PRO at `nvme0n1`** (serial `S7KGNU0X511734N`) backing the single-disk ZFS pool
`zfspv-pool-nvme` suffered a **controller-level failure**. The kernel disabled the device; it no longer
responds even to `Identify Namespace`. ZFS suspended the pool to protect data.

CPU and memory are healthy — node `Ready`, no MemoryPressure/DiskPressure/PIDPressure, CPU req ~53%,
mem req ~45%. `kubectl top` returned no metrics only because prometheus-adapter (the metrics API here)
was restarted during the user's fix attempt.

### Kernel timeline (UTC, from `talosctl -n torvalds dmesg`)

| Time                | Event                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-25 00:53:28 | `nvme nvme0: Admin Cmd QID 0 timeout, reset controller`                                                                   |
| 2026-06-25 00:55:10 | `Device not ready; aborting reset, CSTS=0x1` → `Disabling device after reset failure: -19` → I/O error flood on `nvme0n1` |
| 2026-06-25 21:10:46 | `Pool 'zfspv-pool-nvme' has encountered an uncorrectable I/O failure and has been suspended`                              |
| 2026-06-26 00:13:35 | still `nvme nvme0: Identify namespace failed (-5)` — drive still dead (~23h wedged)                                       |

## Blast radius

- `zfspv-pool-nvme` = **single-disk vdev, no redundancy** (only `nvme0n1p1` carries its zfs label).
- **77 PVCs** live on it (vs. 5 on `zfspv-pool-hdd`) — i.e. nearly every stateful app's DB/config.
- Confirmed-affected: Grafana (`FailedMount ... pool I/O is currently suspended`), Plausible
  (`connection not available, request dropped from queue` → CrashLoop), Home Assistant
  (can't lock `home-assistant_v2.db-shm` on the `zfs` mount; pod `Running` but app hung), plus Loki 1/2,
  Plex Error, Jellyfin/Overseerr not-ready, Pyroscope, etc.

## What's healthy

- Node `torvalds` itself — OS/`/var` is on a **separate** drive `nvme1n1` (990 PRO, serial `S7KGNU0XB15590B`),
  XFS EPHEMERAL partition `nvme1n1p4`. No pressure. That's why the node never went down.
- `zfspv-pool-hdd` (6× Samsung 870 SATA, `sda`–`sdf`) — no errors.

## Why restarting didn't help

A suspended ZFS pool is suspended at the kernel/device level. Rescheduling a pod just remounts the same
dead pool → `FailedMount`/hang again. The user's restart also churned the monitoring stack mid-redeploy,
which made Grafana look worse momentarily.

## Recovery options (owner decision)

1. **Power-cycle `torvalds` to reset the NVMe controller.** Only software path; fastest fix. 990 PRO
   controller hangs sometimes clear after a full power cycle. If `nvme0` re-enumerates, ZFS imports
   `zfspv-pool-nvme` cleanly (COW + _suspended_ = no half-writes → no corruption) and dependent pods
   recover on their own. A **full power-off (shutdown, wait ~30s, power on)** is more reliable than a warm
   `talosctl reboot` for re-initializing a wedged PCIe device.
2. **If the drive doesn't return → SSD physically failed.** Replace `nvme0`, restore the 77 PVCs from
   backup. Velero is running — verify backup coverage for critical data (HA, the Postgres instances)
   _before_ relying on it.

Follow-ups: firmware check on the surviving 990 PRO (`nvme1`); consider redundancy for the nvme pool given
77 PVCs sit on a single disk; this is the known 990 PRO controller-hang / health-decline failure mode.

## Diagnostic commands used

```bash
kubectl get pods -A                                   # found pool I/O suspended in events
kubectl get events -n prometheus --sort-by=.lastTimestamp
talosctl -n torvalds dmesg | grep -iE 'nvme|zfs|I/O error'
talosctl -n torvalds get disks                        # identified nvme0 = S7KGNU0X511734N
kubectl get zv -n openebs -o custom-columns=...        # 77 PVCs on zfspv-pool-nvme
```

## Resolution

Owner did a full **cold power-cycle** of torvalds. On reboot the previously-dead drive re-enumerated
cleanly, ZFS imported `zfspv-pool-nvme` with **no errors**, and all workloads recovered on their own.
The only lingering not-ready pods were stale pre-reboot replicas (Error/ContainerStatusUnknown) pending GC,
each already superseded by a Running pod. A transient `FailedMount` race (`zfs.csi.openebs.io not found in
the list of registered CSI drivers`) self-resolved once the openebs-zfs CSI node plugin re-registered.

### Root cause refined (it was NOT load-related)

First failure was an **admin-queue command** timing out, not data I/O:
`nvme nvme0: opcode 0x2 (Admin Cmd) QID 0 timeout, reset controller` — opcode 0x2 = Get Log Page (a routine
SMART/health-log poll) on an essentially idle box. Controller then failed its reset and was disabled. Classic
**spontaneous 990 PRO controller-hang firmware lockup**, cleared only by a full power cycle.

### Post-recovery SMART (both drives, model = Samsung 990 PRO 4TB)

| Drive                   | Serial          | FW       | Health | Temp  | Used | Spare | Media errs | Err-log entries |
| ----------------------- | --------------- | -------- | ------ | ----- | ---- | ----- | ---------- | --------------- |
| nvme (data, failed one) | S7KGNU0X511734N | 4B2QJXD7 | PASSED | 47 °C | 16%  | 100%  | 0          | **0**           |
| nvme (OS/boot)          | S7KGNU0XB15590B | 4B2QJXD7 | PASSED | 35 °C | 11%  | 100%  | 0          | 0               |

Drive is pristine by every wear/media metric yet hard-locked and logged nothing internally → controller
firmware fault, not wear/media/thermal. Both drives are on the **same already-current firmware (4B2QJXD7)**,
so a firmware update may not be available and can't be assumed to fix it. The OS disk carries identical risk.

## Session Log — 2026-06-25

### Done

- Diagnosed cluster-wide stateful-app outage to a single root cause: `nvme0` (990 PRO, `S7KGNU0X511734N`)
  controller lockup → `zfspv-pool-nvme` (single-disk) suspended 2026-06-25 21:10 UTC. Corrected initial
  "sustained I/O" framing: failure was on an idle admin/Get-Log-Page command.
- Mapped blast radius (77 PVCs) and confirmed node/OS disk/HDD pool healthy.
- Owner cold power-cycled the node; verified full recovery (pool imported clean, all apps Running, no data loss).
- Captured post-recovery SMART for both drives (healthy; FW 4B2QJXD7).

### Remaining (follow-ups — none blocking service)

1. **[VERIFIED — volume data IS in R2]** Backups use the **openebs zfs-localpv Velero plugin**, not Velero
   kopia/FSB (so there's correctly no node-agent/BackupRepositories — I initially checked the wrong mechanism).
   It does per-PVC `zfs send` → R2 bucket `homelab` prefix `zfspv-incr/backups/<backup>/torvalds/zfs/...`
   (~1.37 TB total; `r2` aws profile reads it). Manifests are separately under `torvalds/backups/`.
   Last COMPLETE set = `6hourly-backup-20260625001510` (Jun 25 00:15 UTC, 1.46 GB) — **~38 min before the
   drive died at 00:53**. Post-death sets are 79 KB metadata-only stubs (zfs send had no disk to read).
   Each volume = 2 objects (`.zfsvol` header + data stream); complete set ≈ 92 objects / 1.4–5 GB, stub = 46 / 79 KB.
   Two real gaps remain: (a) Velero marks these backups `Failed` even when full data uploads (chronic partial
   error since ~Jun 24 fails the whole backup status → status is untrustworthy; root-cause the erroring volume);
   (b) no alerting on backup success/freshness (stub backups would only surface during a restore).
2. **Add redundancy / relocate critical DBs** off the single non-redundant NVMe pool (mirror, or move to the
   6-disk SATA pool `zfspv-pool-hdd`).
3. **RMA the failed drive** (`S7KGNU0X511734N`) — on current FW and still hard-failed; keep a spare.
4. Check Samsung for FW newer than 4B2QJXD7 (4TB model); flash both if available.
5. Confirm alerting fires on NVMe controller errors (smartctl/nvme collectors exist; verify alert rules).
6. Garbage-collect stale Error/Unknown pre-reboot pods if they don't clear on their own.

### Caveats

- `zfspv-pool-nvme` has no redundancy — 77 PVCs on one disk. The single point of failure was realized tonight;
  recovery only worked because a power cycle happened to un-wedge the controller. Next time may not be so lucky.
- NVMe device numbering (nvme0/nvme1) is NOT stable across reboots; identify drives by serial, not by name.
- `zpool`/`zfs` aren't in the `openebs-zfs-localpv-node` container PATH; use `talosctl dmesg`/`get disks`/
  `get discoveredvolumes` for host-level checks and `smartctl` via the `smartctl-collector` pod for SMART.
- ZFS suspend protected the data — a _suspended_ (not faulted-mid-write) COW pool imported with zero corruption.
