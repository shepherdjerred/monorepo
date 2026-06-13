# Torvalds thermal investigation

## Status

Partially Complete — CPU solved (AIO cooler + RAPL cap, verified under heavy CI). Both NVMes now have dedicated cooling (active cooler on the OS disk, heatsink on the ZFS drive) and peak ≤ 65 °C NAND on light days. Talos install disk now pinned by serial. Remaining: Grafana thermal alert rules; re-verify NVMe temps on the next heavy CI day.

> **Drive identity warning**: `nvme0`/`nvme1` names are assigned randomly per boot. Identify drives by serial only: OS/EPHEMERAL = `S7KGNU0XB15590B`, ZFS pool = `S7KGNU0X511734N`. Per-name claims in dated sections below reflect that boot's mapping.

## Summary

User reported "lots of thermal issues" on `torvalds` (the homelab server, not their MacBook). Pulled `node_hwmon_temp_celsius` from Grafana/Prometheus. Two compounding problems:

1. **Chronic CPU throttling** — CPU package has hit 97–100 °C every day for the last 7 days. 100 °C is TJMax for the platform → kernel is thermally throttling daily.
2. **Acute NVMe regression today** — `nvme1` Composite jumped from a 53–67 °C recent baseline to **82.85 °C** today (warning threshold = 81.85 °C, critical = 84.85 °C). NAND sensor (`temp3` / Sensor 2) hit **103.85 °C** in the last 24 h.

Workload context: 116 Buildkite pods currently scheduled on `torvalds`, load avg ~30. Buildkite CI is the primary heat source. See `project_kueue_buildkite` memory — Kueue was deployed to manage Buildkite resource use, but thermal capacity isn't a Kueue input.

No Grafana alert rules exist for thermal metrics at all (`tools grafana alerts` returns empty). The thermal regression went unnoticed because nothing was paging.

## Measurements

All from `prometheus` datasource at the Grafana endpoint, queried via `toolkit grafana`.

| Sensor                            | Now   | 24 h max      | 7 d max   | Threshold               | Notes                 |
| --------------------------------- | ----- | ------------- | --------- | ----------------------- | --------------------- |
| CPU package (`coretemp_0/temp1`)  | —     | **100 °C**    | 100 °C    | TJMax ~100 °C           | Throttling daily      |
| Hottest core                      | —     | **100 °C**    | —         | TJMax                   | —                     |
| `nvme1` Composite (temp1)         | 63.85 | **82.85 °C**  | 82.85 °C  | warn 81.85 / crit 84.85 | Triggers SSD throttle |
| `nvme1` Sensor 2 (temp3)          | 86.85 | **103.85 °C** | 103.85 °C | no SSD-set limit        | Likely NAND           |
| `nvme0` Composite                 | 46.85 | 69.85 °C      | 69.85 °C  | warn 81.85 / crit 84.85 | OK                    |
| `nvme0` Sensor 2                  | 68.85 | 96.85 °C      | 96.85 °C  | unset                   | Warm                  |
| `nct6775_656/temp7` (chassis/VRM) | 75    | **87 °C**     | —         | —                       | Hot                   |

7-day CPU max by day (`max_over_time` with daily offset):

```
today  -1d   -2d   -3d   -4d   -5d   -6d
100    100   97    91    100   97    97
```

7-day `nvme1` Composite max by day — note the jump today:

```
today  -1d   -2d   -3d   -4d   -5d   -6d
82.85  63.85 53.85 70.85 53.85 52.85 67.85
```

## Likely causes

- **CPU**: dust on cooler, dried thermal paste, or simply undersized cooling for the sustained Buildkite load. Average CPU is only 7–30 %, but transient bursts immediately saturate TJMax — points to cooler dissipation, not workload.
- **nvme1 today**: spike correlates with current workload (116 BK pods, load 30). Likely either (a) heatsink airflow obstructed, (b) heatsink loose / pad failed, (c) sustained writes from CI cache thrash, or (d) a chassis fan died and only the NVMe slot lost airflow.

## Recommended next steps (not done)

1. **Immediate** — drain Buildkite from `torvalds` or drop Kueue quota until physical check is done. CPU is throttling and `nvme1` is at its drive-defined warning level.
2. **Physical check** — case dust, all fans spinning, CPU cooler mount, NVMe heatsink contact, ambient room temp.
3. **Add Grafana alerts** — none exist for thermals. Suggested rules:
   - `node_hwmon_temp_celsius{chip=~"nvme.*", sensor="temp1"} > 75` (warn) / `> 82` (critical)
   - `node_hwmon_temp_celsius{chip="platform_coretemp_0", sensor="temp1"} > 90` (warn) / `>= 100` (critical)
   - `max(node_hwmon_temp_celsius{chip=~"platform_nct.*"}) > 80` (chassis warn)
4. **Workload sizing** — once cooling is verified, calibrate max concurrent Buildkite pods against thermal headroom, not just CPU/memory.

## Caveats

- Loki has only Kubernetes pod logs, not Talos kernel logs, so I couldn't confirm kernel `thermal` / `nvme overheating` events directly. Throttling is inferred from metrics.
- `temp3` on the NVMe drives has no SSD-set max threshold (returns `0xFFFE`), so the drive may not throttle on it directly — but 100 °C+ on NAND still degrades endurance.
- Prometheus 7-day max == 24-hour max for some sensors, which means peaks are recent (today) — not that retention is short.

## Implementation — CPU power cap

User prioritized **NVMe protection**: the drives sit physically adjacent to the CPU on the ASUS Pro Q670M-C and inherit its radiated heat. Capping CPU package power directly cools the SSD slot. Vcore undervolting is blocked in microcode on 10th-gen+ Intel (Plundervolt mitigation, CVE-2019-11157) — software is restricted to RAPL power caps and cpufreq, with the real undervolt living in BIOS.

### What shipped

New file: `packages/homelab/src/cdk8s/src/resources/cpu-power-cap.ts`

- Creates a `node-tuning` namespace (PSA `enforce: privileged`)
- Privileged DaemonSet, hostPath `/sys` mounted RW
- Shell loop writes `/sys/class/powercap/intel-rapl:0/constraint_{0,1}_power_limit_uw` then reads back; mismatch → `exit 1` so CrashLoopBackOff surfaces firmware lock
- Re-applies every 5 min as safety net against firmware/userspace clobbering
- Liveness probe verifies on-disk PL1 still matches configured value
- Wired in `cdk8s-charts/apps.ts` next to `createKueueConfig`

### Tuning chosen

| Limit           | Value     | Rationale                                                                                                                                                                       |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PL1 (sustained) | **95 W**  | Roughly i7-13700-class. Stock 13900K is 125 W "base" but ASUS firmwares often raise this to unlimited, which is what was driving sustained 100 °C and radiating heat into nvme1 |
| PL2 (burst)     | **140 W** | ~55 % of stock 253 W MTP. Preserves some turbo for short CI steps without overwhelming cooling                                                                                  |

Expected ~25–35 % multi-thread perf cost under sustained Buildkite load. Acceptable trade for SSD endurance. Tunable via the construct's `pl1Watts` / `pl2Watts` parameters — once we confirm NVMe stays under ~70 °C we can loosen.

### Why not other approaches

- **`intel-undervolt` MSR 0x150 writes** — blocked by Plundervolt microcode
- **Disable turbo entirely** — heavier hammer than needed; kills single-thread perf for no benefit
- **`intel_pstate=no_turbo` kernel arg** — doesn't exist (it's a runtime sysfs toggle)
- **Talos `extraKernelArgs`** — already has `cpufreq.default_governor=powersave` and `intel_pstate=passive`; clearly insufficient under bursty CI load
- **BIOS PL1/PL2 + Vcore offset** — best long-term answer, but lives outside Talos and needs a planned reboot — recommended separately

### Follow-ups (still pending)

- Physical check on `torvalds` cooling (fans, dust, CPU paste mount, NVMe heatsink contact, slot airflow)
- BIOS settings: enable "Intel Default Power Limits"; add a `−50 mV` Vcore offset and stress-test
- Add Grafana alert rules (none exist for thermals):
  - `node_hwmon_temp_celsius{chip=~"nvme.*", sensor="temp1"} > 75` warn / `> 82` critical
  - `node_hwmon_temp_celsius{chip="platform_coretemp_0", sensor="temp1"} > 90` warn / `>= 100` critical
- Future: temp-reactive RAPL cap (daemon polls NVMe Composite and tightens PL1 when above threshold)

## Verification — 2026-06-09 (post active cooling)

User installed active cooling on `torvalds` at the 2026-06-08 00:02 PT reboot. Daily `max_over_time` from Prometheus (`toolkit grafana`), temps in °C, with daily write volume and load for workload context (days relative to 2026-06-09):

| Day   | nvme0 Comp/NAND | nvme1 Comp/NAND | Written (nvme0 / nvme1) | load5 max | CPU pkg |
| ----- | --------------- | --------------- | ----------------------- | --------- | ------- |
| −6d   | 52.85 / 79.85   | 70.85 / 97.85   | 337 GB / 1.6 TB         | 297       | 89      |
| −5d   | 45.85 / 67.85   | 52.85 / 74.85   | 167 / 117 GB            | 7         | 75      |
| −4d   | 46.85 / 68.85   | 48.85 / 72.85   | 170 / 108 GB            | 6         | 66      |
| −3d   | 57.85 / 84.85   | 70.85 / 95.85   | 1.7 / 5.1 TB            | 354       | 82      |
| −2d   | 66.85 / 93.85   | 62.85 / 88.85   | 1.6 / 3.1 TB            | 95        | 84      |
| −1d   | 52.85 / 75.85   | 35.85 / 48.85   | 168 / 155 GB            | 13        | 81      |
| today | 51.85 / 77.85   | 34.85 / 47.85   | 240 / 210 GB            | 30        | 80      |

(−1d straddles the reboot; nvme0/nvme1 names may refer to different physical drives before vs after it.)

- **Naming (corrected 2026-06-12)**: `nvme0`/`nvme1` assignment is **random per boot** — not slot-stable and not drive-stable. (An earlier revision of this doc claimed slot-stability; that was wrong.) Proven by the `/var` (EPHEMERAL) filesystem's `device` label flipping across reboots: `nvme0n1p4` May 12–23, `nvme1n1p4` May 23–Jun 6, `nvme0n1p4` Jun 6–7, `nvme1n1p4` Jun 8–9, `nvme0n1p4` as of Jun 12. **Always identify these drives by serial**: OS/EPHEMERAL disk = `S7KGNU0XB15590B`, ZFS pool drive (`zfspv-pool-nvme`) = `S7KGNU0X511734N`. Physically (since the 2026-06-08 maintenance): the OS disk sits in the slot away from the CPU under the active cooler; the ZFS drive sits in the near-CPU slot.
- **Which drive was May's crisis drive**: on 2026-05-24, `/var` was on `nvme1n1p4` — so the overheating "nvme1" (82.85 °C Composite / 103.85 °C NAND) was the **OS/EPHEMERAL disk** (`S7KGNU0XB15590B`). Per the 2026-04-21 wear attribution, that disk is the heavy CI writer: Buildkite overlayfs ≈ 4.2 TB/day on heavy days, ~66% of all NVMe writes, vs the Dagger buildcache's ~0.7–0.9 TB/day on the ZFS drive.
- **Workload confound (added later on 2026-06-09)**: the post-install days were 7–20× lighter on writes (~200 GB/day vs 1.6–5 TB/day on pre-reboot CI days, load5 max 13–30 vs 95–354). The initially-claimed across-the-board improvement was mostly workload, not cooling.
- **Light-day vs light-day comparison** (pre-reboot −4d/−5d vs post-reboot −0d/−1d relative to 2026-06-09, comparable ~100–240 GB/day writes): the OS/EPHEMERAL disk (`S7KGNU0XB15590B`, moved away from the CPU and put under the active cooler) improved to 35/48 °C Composite/NAND from 46–53/68–75. The ZFS drive (`S7KGNU0X511734N`), displaced into the near-CPU slot, was unchanged to slightly worse (52–53/76–78).
- **Conclusion (corrected 2026-06-12): the active cooler went on the RIGHT drive.** The cooled OS disk is both the heavy CI writer (~66% of NVMe writes) and May's 103.85 °C NAND crisis drive. An earlier revision of this doc concluded the opposite ("swap the drives back") by misattributing drive identity across reboots — **do not swap**; identify by serial before drawing per-drive conclusions.
- **2026-06-10/11 follow-up hardware (operator)**: BIOS updated; a heatsink was added to the ZFS drive (`S7KGNU0X511734N`) in the near-CPU slot. 24 h maxes measured 2026-06-12: ZFS drive **39.85/49.85 °C** (was 52/78 bare), OS disk 43.85/64.85 °C, CPU package 86 °C. Both NVMes now have dedicated cooling and sit well inside thresholds; the remaining test is a heavy CI day (multi-TB writes, load5 > 90).
- **Drive roles** (serials; both Samsung 990 PRO 4TB): `S7KGNU0X511734N` hosts the `zfspv-pool-nvme` ZFS pool — the 2 TiB Dagger engine buildcache (`zfs-ssd-buildcache`, sync=disabled), the Buildkite git-mirrors PVC, and all `zfs-ssd` PVCs (Prometheus, Loki, media, Minecraft, …). `S7KGNU0XB15590B` is the Talos system disk (EFI/META/STATE/EPHEMERAL) and takes container overlayfs, image layers, logs, and etcd — which under CI is the **larger** write stream (5.1 TB vs 1.7 TB on the heaviest measured day). A correction to an earlier revision: the ZFS drive is _not_ the main CI write target; EPHEMERAL is.
- **CPU no longer hits TJMax — primarily the AIO cooler, not the RAPL cap**. Timeline (all PT): RAPL cap DaemonSet deployed 2026-05-25 11:11 (running healthy since; liveness probe confirms PL1 sticks). User installed a large AIO CPU cooler at the 2026-05-26 double reboot (13:06 + 15:52). Daily CPU max: 97–100 °C every day through May 26 — **including ~26 h with the cap active but no AIO, where it still hit 100 °C** — then never above 91 °C after the AIO (peaks: 91 on May 28, 89 on Jun 3, 82–84 on the heavy-CI days Jun 6–7). The cap alone did not stop TJMax; the AIO did. The cap still limits sustained draw and radiated heat into the M.2 slots.
- No RAPL power metrics exist (node-exporter `rapl` collector not enabled), so cap-binding (whether the CPU actually rides the 95/140 W ceilings under CI) can't be verified from Prometheus.
- Still missing: Grafana thermal alert rules (none exist as of this check).

## Session Log — 2026-05-24

### Done

- Identified daily CPU thermal throttling (100 °C TJMax) sustained for 7 days
- Identified today's `nvme1` regression (82.85 °C Composite, 103.85 °C NAND) vs baseline
- Implemented `createCpuPowerCap` construct (RAPL PL1 = 95 W / PL2 = 140 W), wired in apps chart
- Verified typecheck, lint, and 247 tests pass; inspected synthesized `apps.k8s.yaml` for correctness
- Documented findings, implementation, and pending follow-ups in this log

### Remaining

- Open the PR for the CPU power-cap DaemonSet
- Operator: physical check on `torvalds` cooling
- Operator: BIOS Vcore offset + PL1/PL2 (best long-term fix)
- Add Grafana thermal alert rules
- After deploy, verify nvme1 Composite stays < 70 °C under load; loosen PL1/PL2 if there's headroom

### Caveats

- The cap only protects against CPU-radiated heat. If the NVMe is hot because its own controller/NAND is being hammered (sustained CI writes, ZFS L2ARC churn), this PR helps only marginally. Physical inspection still required.
- If the ASUS firmware locks RAPL via MSR 0x610, the DaemonSet will CrashLoopBackOff with a clear FATAL message — that's the signal to switch to BIOS-only configuration
- Could not access Talos kernel logs via Loki (only K8s pod logs flow there) to directly confirm `nvme0n1: critical temperature warning` events

## Session Log — 2026-06-09

### Done

- Evaluated the active cooling installed at the 2026-06-08 00:02 PT reboot. Initial read ("everything improved") was confounded by workload: post-install days wrote ~200 GB/day vs 1.6–5 TB/day on pre-reboot CI days. Light-day vs light-day comparison shows only the system disk improved (~15–25 °C); ~~the cooler favors the wrong drive~~ **(WRONG — corrected 2026-06-12: the system disk IS the heavy CI drive; the cooler is on the right drive)**
- ~~Resolved drive naming with operator input: names are slot-stable~~ **(WRONG — corrected 2026-06-12: naming is random per boot; only serials are stable.** The physical part stands: the system disk moved to the far slot under the active cooler, the ZFS drive to the near-CPU slot)
- Mapped drives to workloads: `nvme0n1` (S7KGNU0X511734N) = ZFS pool `zfspv-pool-nvme` (Dagger 2 TiB buildcache + all zfs-ssd PVCs — the CI write target); `nvme1n1` (S7KGNU0XB15590B) = Talos system/EPHEMERAL disk. Note: under heavy CI the EPHEMERAL disk also takes multi-TB daily writes (5.1 TB on −3d under pre-reboot naming)
- Reconstructed the CPU remediation timeline: RAPL cap deployed 2026-05-25 11:11 PT (DaemonSet healthy since, 8 restarts = reboots); AIO cooler installed at the 2026-05-26 double reboot. CPU hit 100 °C with cap-only for ~26 h, never after the AIO → AIO is the primary fix for TJMax, cap is secondary
- Confirmed `toolkit grafana alerts` still returns no alert rules
- Updated Status line and added Verification section to this doc

### Remaining

- ~~Swap the drives so the ZFS/CI drive sits under the active cooler~~ **(RETRACTED 2026-06-12 — based on misattributed drive identity; the cooler is on the right drive. The ZFS drive got its own heatsink on ~2026-06-10/11 and now peaks at 39.85/49.85 °C.)**
- Grafana thermal alert rules (queries already specified in Follow-ups above) — these would catch the next heavy-CI thermal excursion automatically
- Re-verify NVMe temps during the next heavy CI day (multi-TB writes / load5 > 90) — the new NVMe cooling is untested under real load (CPU has been tested: 82–84 °C on the Jun 6–7 heavy days with AIO + cap)
- Consider enabling node-exporter's `rapl` collector to expose package power — would let us verify whether the 95/140 W cap binds under CI, and whether PL1/PL2 can be loosened now that the AIO handles dissipation

### Caveats

- CPU TJMax elimination is attributable primarily to the AIO (cap-only period May 25–26 still hit 100 °C); with the AIO in place, the RAPL cap may now be unnecessarily conservative
- ~~Slot↔name mapping (near-CPU = `nvme0`) … has held across every reboot since mid-May~~ **(WRONG — corrected 2026-06-12: the mapping flips randomly per boot; see the naming bullet in the Verification section)**

## Session Log — 2026-06-12

### Done

- **Corrected this doc's 2026-06-09 errors**: drive naming is random per boot (proven via the `/var` device label flipping across May–June reboots), NOT slot-stable; the active cooler is on the RIGHT drive (the OS/EPHEMERAL disk, which is both the heavy CI writer per the 2026-04-21 wear attribution and May's 103.85 °C NAND crisis drive). Retracted the "swap drives back" recommendation.
- **Fixed the Talos install-disk footgun**: `packages/homelab/src/talos/patches/image.yaml` and the live machine config now select the install disk via `diskSelector.serial: S7KGNU0XB15590B` instead of `disk: /dev/nvme0n1` + `wipe: true`, which had a per-boot coin-flip chance of pointing at the ZFS pool drive on a reinstall. Applied live without reboot; verified node Ready. (`diskSelector` always has priority over `disk` per Talos docs; the stale `disk` field was also removed from the live config.)
- Recorded operator hardware updates (~2026-06-10/11): BIOS updated; heatsink added to the ZFS drive. 24 h maxes on 2026-06-12: ZFS drive 39.85/49.85 °C Composite/NAND, OS disk 43.85/64.85 °C, CPU 86 °C.
- Investigated the wear doc's "Plex 471 GB/day" anomaly: it was a one-off burst Apr 17–22 (~2.7 TB total, ~0.3 GB/day since) — noted as stale in `guides/2026-04-21_nvme-wear-attribution.md`.
- Answered the "ZFS on the cooled drive / move BK+Dagger to OS drive" question: technically possible (Talos `VolumeConfig` EPHEMERAL maxSize + `RawVolumeConfig`, requires wiping EPHEMERAL) but not recommended — BK overlayfs is already on the cooled OS drive, and moving the Dagger cache there would forfeit the lz4/sync=disabled write reduction on the busiest drive. Keep current layout. Plan: `packages/docs/archive/completed/2026-06-12_talos-install-disk-selector.md`.

### Remaining

- Grafana thermal alert rules (PromQL specified in Follow-ups above) — still none exist
- Re-verify both NVMe temps + CPU on the next heavy CI day (multi-TB writes / load5 > 90)
- Optional: enable node-exporter `rapl` collector to see whether the cap binds under CI
- Optional hardware path discussed: M.2→PCIe adapter in the free x16 slot (board runs on iGPU, all PCIe slots empty) for a third drive or to mirror `zfspv-pool-nvme`

### Caveats

- The BIOS update (~2026-06-10/11) may have reset firmware power-limit settings; the cpu-power-cap DaemonSet re-applies RAPL every 5 min so the cap survives, but the CPU 24 h max ticked up to 86 °C — watch on the next heavy CI day
- All cross-boot per-drive analysis in this doc must go through serials; per-name claims are only valid within the boot they were measured in

## Session Log — 2026-06-12 (later: CPU performance restore)

CPU performance limits rolled back now that the AIO + per-drive NVMe cooling are in place. Full detail in `packages/docs/plans/2026-06-12_torvalds-cpu-performance-restore.md`.

- RAPL cap raised to Intel stock 125/253 W (`apps.ts`; deploys post-merge). The DaemonSet stays as a guard against ASUS unlimited-PL firmware defaults.
- `cpufreq.default_governor=powersave` + `intel_pstate=passive` removed from the factory schematic; new image ID `cb410305…74c38c` regenerated (and `update-image-id.ts` fixed to refresh the pinned digest — it previously left it stale, silently resolving to the old image).
- Live machine config: new install image, dead `install.extraKernelArgs` removed.
- **Pending operator action**: `talosctl upgrade` (reboot) to boot the cleaned image — command in the plan doc.
