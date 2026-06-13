# NVMe Temperature Check — 2026-06-12

## Status

Complete

## Snapshot

Checked live Grafana/Prometheus metrics for `torvalds` via `toolkit gf query --instant --json`.

Current drive identity from `smartmon_device_info{type="nvme"}`:

| Device       | Serial            | Role                                                           |
| ------------ | ----------------- | -------------------------------------------------------------- |
| `/dev/nvme0` | `S7KGNU0X511734N` | ZFS pool drive (`zfspv-pool-nvme`)                             |
| `/dev/nvme1` | `S7KGNU0XB15590B` | Talos OS/EPHEMERAL disk (`/var` currently on `/dev/nvme1n1p4`) |

Current SMART composite temperature:

| Device       | Current |
| ------------ | ------: |
| `/dev/nvme0` |   48 °C |
| `/dev/nvme1` |   36 °C |

24h highs:

| Metric           | `/dev/nvme0` | `/dev/nvme1` |
| ---------------- | -----------: | -----------: |
| SMART composite  |        50 °C |        47 °C |
| hwmon max sensor |     64.85 °C |     56.85 °C |

7d highs:

| Metric           | `/dev/nvme0` | `/dev/nvme1` |
| ---------------- | -----------: | -----------: |
| SMART composite  |        58 °C |        69 °C |
| hwmon max sensor |     93.85 °C |     95.85 °C |

Other live checks:

- `node_hwmon_temp_alarm{chip=~"nvme_.*"}` is `0` for both drives.
- `smartmon:device_healthy{type="nvme"}` is `1` for both drives.
- Current NVMe wear: `/dev/nvme0` = 16 %, `/dev/nvme1` = 10 %.
- Last 24h writes were moderate: `nvme0n1` about 465 GiB, `nvme1n1` about 333 GiB.
- Last 24h max `node_load5` was about 67.74, below the previous heavy-CI verification target of load5 > 90.
- Rendered a 6h ASCII chart from `max by (disk) (smartmon:temperature_celsius{type="nvme"})`.

Follow-up write snapshot:

| Device    |    Last 1h |    Last 6h |   Last 24h |     5m rate |    30m rate |
| --------- | ---------: | ---------: | ---------: | ----------: | ----------: |
| `nvme0n1` | 361.99 GiB | 485.62 GiB | 485.64 GiB | 67.76 MiB/s | 89.89 MiB/s |
| `nvme1n1` | 189.30 GiB | 250.54 GiB | 332.38 GiB | 69.66 MiB/s | 44.12 MiB/s |

`/var` is currently mounted from `/dev/nvme1n1p4`.

## Session Log — 2026-06-12

### Done

- Loaded the Grafana, Kubernetes, and storage skills.
- Queried live SMART and hwmon temperature metrics for both NVMe drives.
- Confirmed both drives are healthy and have no current NVMe hwmon alarm bit set.
- Reconfirmed current serial-to-device mapping instead of trusting unstable `/dev/nvme*` names.
- Rendered a 6h ASCII graph of SMART composite temperatures.
- Checked current NVMe write volume and write rates over 1h, 6h, and 24h.
- Recorded the live snapshot in this log.

### Remaining

- Re-check during a heavy CI day with multi-TB writes or load5 > 90 to validate thermal headroom under worst-case workload.

### Caveats

- `/dev/nvme0` and `/dev/nvme1` names are not stable across boots; use serials for drive identity.
- The 7d hwmon highs likely include hotter periods before or during the recent cooling/CPU changes; the last 24h readings are the best current health signal.
