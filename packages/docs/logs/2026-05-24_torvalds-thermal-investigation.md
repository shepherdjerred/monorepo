# Torvalds thermal investigation

## Status

Partially Complete — diagnostic done, CPU power-cap DaemonSet PR opened. NVMe-side remediation (physical, alerts) still pending.

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
