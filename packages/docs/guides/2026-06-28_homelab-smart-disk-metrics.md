# Homelab SMART / NVMe Disk Metrics

## Status

Complete (serial-stability fix shipped in PR #1154, 2026-06-13).

## How metrics are emitted

torvalds emits SMART telemetry itself via two node-exporter textfile collectors in `packages/homelab/src/cdk8s/src/resources/monitoring/`:

- `smartmon.sh` → `smartmon_*` metrics, labeled `disk="/dev/nvme0"`/`/dev/sda` plus `type` (`nvme`/`sat`). Used by the Grafana smartctl dashboard.
- `scripts/nvme_metrics.py` → `nvme_*` metrics (nvme-cli), labeled `device="nvme0n1"`. Used by the `nvme.rules` alerts (canonical for NVMe temp/wear).

## The serial-stability gotcha

Both collectors key per-drive metrics on the **unstable device path** (kernel enumeration; can swap across reboots/slot changes). The stable `serial`/`model` live ONLY on the `*_device_info` info-metric. Alerts/dashboards must join `*_device_info` via `group_left` and key on `serial`/`serial_number` (PR #1154 did this in `nvme.ts`, `smartctl.ts`, `smartctl-dashboard.ts`, `smartctl-panels.ts`; dashboard `$serial` variable, legends `{{device_model}} {{serial_number}}`).

Further gotchas:

- node-exporter's built-in `node_hwmon_temp_celsius{chip="nvme_nvme0"}` is ALSO an enumeration label with no join path to serial — prefer the `nvme_*`/`smartmon_*` collectors.
- `smartmon.sh` originally parsed only the ATA `Device Model` (NVMe `device_model` blank) — fixed to map `Model_Number`. It also used GNU-only `sed 's/^ \+//'` that no-ops on BSD sed → now `s/^[[:space:]]*//`.

## Fleet

2× Samsung 990 PRO 4TB (NVMe, serials S7KGNU0XB15590B / S7KGNU0X511734N) + 6× Samsung 870 EVO 4TB (SATA, ZFS). NVMe crit temp 84.85°C. The 990 PROs hit 94–96°C under heavy CI ~2026-06-07; active+passive NVMe cooling added the week of 2026-06-13 → 47–64°C under load. SMART clean: wear 10%/16%, spare 100%, 0 media errors, fw `4B2QJXD7` (past the buggy 990 PRO firmware).
