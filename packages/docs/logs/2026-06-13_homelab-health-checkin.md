# Homelab Health Check-in — 2026-06-13

## Status

Complete

## Summary

Read-only health check of the `torvalds` single-node Talos cluster via Grafana/Prometheus (`toolkit grafana query`). Node is **healthy but busy** — actively running CI. Three workload-level issues found (unrelated to node health).

## Node metrics (torvalds, 32 cores / 125 GiB)

| Metric         | Value                                                   | Notes                                                                                       |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| CPU            | ~69%                                                    | user 14.0 cores + system 6.5 cores; iowait 0.39, 0 blocked procs                            |
| Memory         | 90 / 125 GiB (72%)                                      | no swap (Talos)                                                                             |
| Load (1/5/15m) | 45.8 / 37.2 / 26.7                                      | high vs 32 cores but driven by CI build bursts, not I/O                                     |
| Temps          | CPU pkg 61°C, cores 47–58°C; NVMe 37–58°C; HDDs 28–31°C | all healthy; nct6775 temp7=79°C likely VRM/mislabeled (sibling sensors read bogus −11/0/12) |
| Disk           | `/var` 45.6% (nvme0n1p4)                                | plenty of room                                                                              |
| Disk I/O       | nvme1n1 30%, nvme0n1 26%                                | moderate                                                                                    |
| Uptime         | 88 min                                                  | **recent reboot** (~1.5h ago)                                                               |

Top CPU: `dagger-helm-engine` 2.98 cores (CI build). Top mem: dagger-helm-engine 6.64 GiB, loki 2.69, prometheus 2.11, apiserver 1.84.

Conclusion on load: load avg of ~46 looks alarming but actual CPU utilization is ~67%, iowait negligible, zero D-state procs — it's inflated by many short-lived parallel CI build processes (Dagger + Buildkite). Transient and expected.

## Workload issues found

1. **mario-kart** `mario-kart-75f9c9fcd5-zbf72` — `CrashLoopBackOff`, 16 restarts, not ready (service down).
2. **redlib** — flapping: `redlib-7b4d676c-jn4ns` ready=1 (44 restarts), `redlib-7b4d676c-pwv5q` ready=0 (46 restarts). Service intermittently up; looks like a stuck/flapping rollout.
3. **mcp-gateway** `mcp-gateway-656599c5bc-2ttcl` — `CreateContainerConfigError`, Pending (config issue, likely missing secret/configMap key). Matches the mcp-gateway MCP servers failing to connect at session start.

The many buildkite `Failed`-phase pods are terminated ephemeral CI job pods — normal churn, not a problem.

## NVMe deep-dive + metric-stability fix (follow-up in same session)

User pushed back: "are we 100% sure NVMe is OK?" — historically they struggle under CI load.

- Drives: 2× **Samsung 990 PRO 4TB** (NVMe) + 6× Samsung 870 EVO 4TB (SATA, ZFS pool). Crit temp 84.85°C.
- **~6 days ago (≈06-07)** both NVMe hit **93.85°C (nvme0) / 95.85°C (nvme1)** — ~10°C over critical — for ~3 min / ~56 min respectively; CPU pkg hit 84°C same day → whole-box heat-soak under heavy CI. Real thermal event, matches the user's memory.
- **Resolved**: user added active+passive NVMe cooling **this week**. Since then 47–64°C even under load. Recent data = the fix working.
- SMART health (via the cluster's own collector — see below) is clean: wear 10%/16%, spare 100%, 0 media errors, 0 critical warnings, firmware `4B2QJXD7` (past the buggy 990 PRO firmware). The 06-07 excursion left no measurable damage.

**Metric stability fix → PR #1154** (`fix(homelab): identify SMART/NVMe metrics by serial, not unstable /dev path`):

- User noted metrics are keyed by the dev path, unstable across reboots. Confirmed: the cluster emits SMART itself via two node-exporter textfile collectors — `smartmon.sh` (`smartmon_*`, `disk=/dev/nvme0`) and `nvme_metrics.py` (`nvme_*`, `device=nvme0n1`). Both key every per-drive metric on the unstable device path; stable `serial`/`model` live only on the `*_device_info` metrics.
- Fixed the **consumers** (idiomatic info-metric join, no collector change): `nvme.ts` + `smartctl.ts` alert rules and the `smartctl-dashboard.ts`/`smartctl-panels.ts` Grafana dashboard now `group_left`-join `*_device_info` and key on `serial`/`serial_number`.
- Also fixed `smartctl.ts` alerts that referenced **non-existent** labels (`{{ $labels.device }}`, `{{ $labels.model_name }}` → rendered blank) and a broken NVMe/SATA split (`device=~".*/nvme.*"` matched nothing; negation matched everything) → now uses the real `type` label; removed dead duplicate `SmartNvmeTemperature{High,Critical}`.
- Verified: typecheck, eslint, `bun test` (252 pass), cdk8s synth + helm lint all green; joined queries return serial-labeled series live.

## Session Log — 2026-06-13

### Done

- Pulled node CPU/mem/load/temps/disk/uptime + top pod consumers + pod health via `toolkit grafana query` (Prometheus default datasource).
- Identified 3 crashlooping/misconfigured workloads (mario-kart, redlib, mcp-gateway).
- NVMe thermal-history deep-dive; confirmed the 06-07 over-critical event and that the user's cooling mod resolved it; verified SMART health clean.
- **Shipped PR #1154** — serial-stable SMART/NVMe alert rules + Grafana dashboard (info-metric join), plus fixes to blank-label annotations and the broken NVMe/SATA temp split. Follow-up commit also taught `smartmon.sh` to populate `device_model` for NVMe (parses `Model Number`) and fixed a GNU-only `sed \+` that no-ops on BSD/macOS (left parsed values padded + broke the health check).

### Remaining

- 3 workload issues from the health check are unremediated (user only asked for a check-in): mcp-gateway `CreateContainerConfigError` (likely missing secret/configMap key — `kubectl -n mcp-gateway describe pod`), mario-kart + redlib crashloops (Loki `{namespace="mario-kart"}` / `{namespace="redlib"}`).
- PR #1154 needs review/merge → ArgoCD sync before the new dashboard/alerts are live.

### Caveats

- Node rebooted ~88 min ago; some restart counts may partly reflect post-reboot churn, but redlib's 44–46 lifetime restarts and mario-kart's active CrashLoopBackOff are genuine crashloops, not just reboot noise.
- nct6775 motherboard sensors report several bogus values; only coretemp/nvme/drive temps are trustworthy.
- The earlier `node_hwmon_temp_celsius{chip="nvme_nvme0"}` readings (node-exporter built-in) use the same unstable enumeration label; cross-reboot per-drive attribution there is uncertain. The cluster's own `nvme_*`/`smartmon_*` collectors (now serial-joined via PR #1154) are the canonical source.
- Worktree friction: fresh worktree's `packages/homelab/` root lacked local eslint+jiti, so the `eslint-homelab` pre-commit hook (`bunx eslint` from that root) fell back to global eslint 10.4.1 and failed on jiti. Fix: `bun install` in `packages/homelab/` (root, not just `src/cdk8s`). `setup.ts` only installs the subpackages.
