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

## Session Log — 2026-06-13

### Done

- Pulled node CPU/mem/load/temps/disk/uptime + top pod consumers + pod health via `toolkit grafana query` (Prometheus default datasource).
- Identified 3 crashlooping/misconfigured workloads (mario-kart, redlib, mcp-gateway).

### Remaining

- User only asked for a check-in (read-only). No remediation performed. Next steps if desired: `kubectl -n mcp-gateway describe pod` to find the missing config key; inspect mario-kart + redlib crash logs (Loki: `{namespace="mario-kart"}` / `{namespace="redlib"}`).

### Caveats

- Node rebooted ~88 min ago; some restart counts may partly reflect post-reboot churn, but redlib's 44–46 lifetime restarts and mario-kart's active CrashLoopBackOff are genuine crashloops, not just reboot noise.
- nct6775 motherboard sensors report several bogus values; only coretemp/nvme/drive temps are trustworthy.
