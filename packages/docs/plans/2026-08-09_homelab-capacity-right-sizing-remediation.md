---
id: plan-2026-08-09-homelab-capacity-right-sizing-remediation
type: plan
status: in-progress
board: false
---

# Homelab capacity right-sizing remediation

## Summary

The 7-day and 30-day capacity audit found safe headroom for more light and
mixed Buildkite work on liskov, while CPU, memory, and ephemeral-storage Kueue
quotas should remain the hard safeguards for heavy mixes. The fresh rollout
baseline on 2026-08-09 showed about 83.5Gi Kubernetes allocatable memory on
liskov, no Kueue backlog, and no node-pressure condition. Plane has been
removed and is outside this remediation.

Direct read-only Talos API access to liskov on TCP/50000 timed out. Kubernetes
and Prometheus remain the rollout evidence sources; Talos-only cgroup peaks are
unverified until the follow-up commands in the liskov runbook succeed.

Implement this as one GitOps PR and one coordinated deployment. Increase mixed
and light CI throughput while retaining resource-aware Kueue safeguards,
right-size persistent workloads against the audit evidence, add cache
maintenance and predictive storage monitoring, and validate the rollout under
ordinary production and CI traffic.

## Buildkite and Kueue

- Raise Buildkite and Kueue's matching pod-count cap from 20 to 24 while
  retaining 24 CPU, 80Gi memory, and 100Gi ephemeral-storage quotas.
- Preserve Kueue as the hard safeguard for heavy mixes. Count 24 must not imply
  that 24 verify, Playwright, or image workloads can bypass the resource quotas.
- Map and test the complete pod reservation, including the agent's 50m/64Mi and
  checkout's 50m/1Gi reservations:

| Buildkite pod type                                       |         Complete reservation |
| -------------------------------------------------------- | ---------------------------: |
| Verify                                                   | 1.1 CPU / 15.06Gi, unchanged |
| Playwright                                               |             1.1 CPU / 5.06Gi |
| Image/BuildKit client                                    |             1.1 CPU / 2.06Gi |
| PR dry-run                                               |                350m / 1.81Gi |
| ArgoCD sync                                              |                350m / 1.56Gi |
| Semgrep/Trivy                                            |                350m / 1.56Gi |
| Normal, light/OpenTofu, Resume, alert-dashboard-postgres |                    Unchanged |

- Preserve current limits. Replace stale active comments about DinD, R2-backed
  Turbo cache, and 91Gi liskov allocatable memory with the current remote
  BuildKit, local ZFS Turbo-cache, and approximately 83.5Gi allocatable model.

## Persistent workloads

Apply the audited request and limit matrix. `None` means no CPU or memory limit
in that dimension; existing non-CPU/memory device limits remain intact.

| Workload/container      |                                   Requests |          Limits |
| ----------------------- | -----------------------------------------: | --------------: |
| Birmel                  |                               50m / 1280Mi |            None |
| BuildKit daemon         |                                 500m / 5Gi |    8 CPU / 32Gi |
| qBittorrent             |                              200m / 4608Mi |     2 CPU / 6Gi |
| qBittorrent gluetun     |                                25m / 128Mi |            None |
| qBittorrent exporter    |                                 10m / 64Mi |            None |
| qBittorrent config seed |                                 10m / 16Mi |            None |
| Plex                    |             Retain CPU policy / 8Gi memory | No memory limit |
| Plex exporter           |                                 10m / 32Mi |            None |
| MCP gateway             |                                50m / 768Mi |   500m / 1536Mi |
| MCP render-config init  |                                 10m / 16Mi |            None |
| Scout beta              |                                  50m / 2Gi |            None |
| Scout production        |                              100m / 2560Mi |            None |
| Tempo                   |                                1 CPU / 2Gi |            None |
| Temporal core worker    |                                 500m / 3Gi |   1.5 CPU / 6Gi |
| Temporal Glitter worker |                                1 CPU / 3Gi |     2 CPU / 6Gi |
| Loki single binary      |                                 250m / 3Gi |     4 CPU / 6Gi |
| Loki results cache      | 100m / chart-derived from 256Mi allocation |   Chart-derived |
| Loki chunks cache       |          100m / existing 4096Mi allocation |       Unchanged |

- Set Loki results-cache allocated memory to 256Mi.
- Leave Kueue controller, Prometheus server, Grafana, BuildKit GC/PVC,
  PinchTab, Resume, alert-dashboard-postgres, ZFS ARC, and Talos reservations
  unchanged.
- Add request-only monitoring baselines: adapter 20m/128Mi, operator
  100m/128Mi, kube-state-metrics 20m/128Mi, blackbox 20m/64Mi, node exporter
  10m/64Mi, Grafana sidecars 10m/128Mi, image renderer 50m/512Mi, Prometheus
  reloaders and Loki low-overhead helpers 10m/64Mi, and Loki rule sidecar
  10m/128Mi.

## Tailscale proxy sizing

- Reserve 50m/128Mi request-only for the operator.
- Create request-only `standard`, `medium`, and `heavy` ProxyClasses, with no
  limits:

| Class            | Proxy request | Init request |
| ---------------- | ------------: | -----------: |
| Standard/default |    20m / 64Mi |    5m / 16Mi |
| Medium           |   20m / 128Mi |    5m / 16Mi |
| Heavy            |   50m / 256Mi |    5m / 16Mi |

- Extend the internal ingress construct with an optional typed proxy-class
  selector that emits `tailscale.com/proxy-class`.
- Assign heavy to ChartMuseum and SeaweedFS S3.
- Assign medium to turbo-cache, Bazarr, Loki, Sonarr, PinchTab, Minecraft
  Bluemap, Plex, MCP gateway, Maintainerr, Alertmanager, and ArgoCD.
  All other proxies use standard.

## Storage and cache controls

- Keep Movies at 6Ti and do not automate deletion. Accept its approximately
  44-day runway at the audit's observed growth rate.
- Add PVC projected-full alerts from positive seven-day growth sustained for
  six hours: warning within 60 days and critical within 14 days.
- Add PVC and ZFS panels for fill, 7/30-day growth, days to full, inode
  pressure, fragmentation, and pool free space.
- Add a daily 02:30 Temporal maintenance schedule on the maintenance queue. It
  calls Turbo cache's authenticated `POST /v8/clean` endpoint for team slug
  `monorepo` with `olderThan=30`, reads the token from the existing
  1Password-backed `buildkite-ci-secrets`, validates `{deleted, scanned}`, and
  publishes success/failure plus deletion/scanned metrics.
- Alert when cleanup has not succeeded for 36 hours. Rename maintenance metric
  label `job` to `maintenance_job` in every producer, query, alert, and test.
- Keep Turbo's 256Gi PVC, Prometheus's 256Gi/200GB/365-day settings, Loki's
  128Gi/90-day settings, BuildKit's 300Gi cache and 240Gi/60Gi GC thresholds,
  and `/var` thresholds unchanged.

## Dashboards and alerts

- Expand the Buildkite dashboard with active/inadmissible pending and admitted
  workloads, quota usage/reservations, p50/p95/p99 admission delay, limiter
  cap/tokens/queue, concurrency mix, and limiter queue delay.
- Add AMD Tctl current/p95/p99/max, time above 90/94/95 degrees Celsius, CI
  concurrency, CPU saturation, and disk-I/O p95/p99 correlation.
- Add NVMe lifetime plus 24-hour/seven-day writes by stable serial, wear, spare,
  media errors, unsafe shutdowns, temperature, host-write commands, error-log
  entries, and critical warnings.
- Preserve CPU alerts above 90 degrees Celsius for 15 minutes and above 94
  degrees Celsius for five minutes, plus the existing NVMe health/write alerts.
- Make the Grafana query audit substitute `$cluster`, `$serial`, and `$volume`
  through a deterministic tested helper. Any invalid query makes the audit fail;
  acceptance requires zero invalid queries after deployment.

## Talos and cooling

- Do not change Talos reservations, eviction floors, PID limits, ZFS ARC, or
  the BIOS 105W Eco setting.
- Complete the operator-owned
  [`liskov-cooling-inspection`](../todos/liskov-cooling-inspection.md) before
  allowing the cap-24 soak. Inspect mounting pressure, paste/contact, pump and
  fans, fan curve, and chassis airflow.
- Do not purchase a cooler based on an isolated maximum. If ordinary cap-24 CI
  sustains AMD Tctl above 95 degrees Celsius for five minutes, revert cap 20
  through GitOps and require cooling remediation before retrying.
- Attempt read-only Talos API verification. While TCP/50000 remains
  inaccessible, use Prometheus/Kubernetes evidence and keep Talos-only cgroup
  peaks explicitly unverified with exact `talosctl read` commands in the
  liskov runbook.

## Internal interfaces and documentation

- Add stage-specific Scout resource selection, typed Tailscale proxy-class
  selection, and the Turbo-cache maintenance activity/workflow/schedule.
- Change the internal maintenance metric label contract to
  `maintenance_job`; no public external API changes are introduced.
- Correct stale active capacity documentation and archive superseded completed
  plans according to the documentation taxonomy.
- Track final acceptance in
  [`homelab-capacity-rollout-acceptance`](../todos/homelab-capacity-rollout-acceptance.md),
  with report-only Temporal checks at deployment, 24 hours, and seven days.
  Retimestamp the blocks in the open PR if the planned deployment window moves.

## Verification and rollout

- Add Buildkite validation tests for every pod type, complete-pod reservation,
  and cap/Kueue lockstep.
- Add synthesis tests for the persistent workload matrix, Tailscale
  ProxyClasses/annotations, maintenance secret mount, alerts, and dashboards.
- Add Temporal tests for authentication, response validation, retries, token
  redaction, metrics, registration, and scheduling.
- Add Prometheus-rule tests for predictive PVC capacity and
  `maintenance_job`, plus deterministic Grafana substitution/query tests.
- Run focused typecheck, tests, lint, Helm/CDK8s synthesis, Talos validation,
  1Password checks, generated-drift checks, and then `bun run verify`.

Submit one git-spice PR and deploy only through the normal main Buildkite and
ArgoCD release path after CI and review are green. Do not use fixed-corpus mode.
Exercise ordinary production and CI traffic only; fixed-corpus mode pushes
images and performs real OpenTofu applies and is outside this rollout.

The seven-day rollout remains open until checks at deployment, 24 hours, and
seven days show:

- Kueue admission p95 at or below five seconds.
- No OOM, eviction, or node-pressure condition.
- liskov MemAvailable at or above 16Gi.
- Disk-I/O p99 at or below 70%.
- No SSD-write alert regression.
- No five-minute AMD Tctl excursion above 95 degrees Celsius.

If a gate fails, use an emergency GitOps revert to restore cap 20 and the
affected reservations. Turbo cleanup can be disabled independently; deleted
entries are rebuildable artifacts older than 30 days.

## Assumptions

- The 2026-08-09 live baseline and current `origin/main` supersede prior stale
  measurements.
- Movies storage risk is consciously accepted; this rollout adds visibility,
  not capacity or deletion.
- Count 24 improves light and mixed concurrency while the existing Kueue CPU,
  memory, and ephemeral quotas remain the hard safeguards for heavy mixes.
- Rollout acceptance remains open until the seven-day evidence is complete.
