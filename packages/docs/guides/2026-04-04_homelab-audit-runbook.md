# Homelab Infrastructure Audit Runbook

Repeatable procedure for a comprehensive health audit of the `torvalds` cluster. Run periodically or when investigating issues.

## Prerequisites

All tools must be authenticated before starting:

| Tool       | Context                                                                   | Check                                         |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| `kubectl`  | `admin@torvalds`                                                          | `kubectl get nodes`                           |
| `talosctl` | `torvalds`                                                                | `talosctl version`                            |
| `argocd`   | `admin`                                                                   | `argocd app list`                             |
| `velero`   | —                                                                         | `velero backup get`                           |
| `toolkit`  | Grafana + PagerDuty + Bugsink env vars                                    | `toolkit gf alerts`                           |
| `temporal` | `TEMPORAL_ADDRESS=localhost:7233` (after `kubectl port-forward`)          | `temporal operator cluster health`            |
| `bk`       | `sjerred` org selected (`bk use sjerred`), token in `BUILDKITE_API_TOKEN` | `bk build list --pipeline monorepo --limit 1` |
| `gh`       | GitHub auth (`gh auth status`)                                            | `gh pr list --limit 1`                        |

## Execution Strategy

Run 7 parallel agents for speed. Each section is independent and read-only.

| Agent | Scope                           | Sections   |
| ----- | ------------------------------- | ---------- |
| A     | Talos + Node                    | 1          |
| B     | K8s Workloads                   | 2, 3       |
| C     | ArgoCD + Storage                | 4, 5       |
| D     | Monitoring + Alerts + Incidents | 6          |
| E     | Hardware + Network              | 7, 8       |
| F     | Error Tracking (Bugsink)        | 9          |
| G     | Temporal + CI + PRs             | 10, 11, 12 |

## Section 1: Talos Node Health

```bash
talosctl health                    # Overall cluster health (etcd, kubelet, API server)
talosctl get members               # Cluster membership
talosctl dmesg --tail 100          # Recent kernel messages (hardware errors, ZFS, OOM)
talosctl services                  # Talos system services status
talosctl version                   # Client/server version alignment
talosctl disks                     # Disk enumeration and health
```

Flag: client/server version mismatch, any service not running, kernel errors related to hardware or ZFS.

## Section 2: Kubernetes Cluster Health

```bash
kubectl get nodes -o wide                                    # Node status, version, IPs
kubectl top nodes                                            # CPU/memory utilization
kubectl get events -A --sort-by=.lastTimestamp | head -80    # Recent cluster events
```

Flag: node NotReady, high resource utilization (>85% memory), warning/error events.

## Section 3: All Workloads

### Pods

```bash
kubectl get pods -A | grep -v Running | grep -v Completed    # Non-healthy pods
```

Look for: CrashLoopBackOff, Error, Pending, ImagePullBackOff, high restart counts.

For any unhealthy pod:

```bash
kubectl logs <pod> -n <ns> --tail=50
kubectl describe pod <pod> -n <ns>
```

### Other resources

```bash
kubectl get deployments -A             # Replica readiness (READY vs DESIRED)
kubectl get statefulsets -A            # Replica readiness
kubectl get daemonsets -A              # Desired vs Ready mismatch
kubectl get jobs -A                    # Failed jobs
kubectl get cronjobs -A                # Suspended, stale last-schedule
kubectl get pv                         # Released, Failed PVs
kubectl get pvc -A                     # Pending, Lost PVCs
```

## Section 4: ArgoCD Health & Sync Status

```bash
argocd app list                        # Sync status + health for all apps
```

For any Degraded, OutOfSync, Missing, or Unknown apps:

```bash
argocd app get <app-name>              # Detailed status, sync errors, conditions
```

Note: OutOfSync with Healthy status and manual sync policy is normal — just means pending chart changes.

## Section 5: Storage & Backups

### ZFS Health (via Prometheus)

```bash
toolkit gf query 'zfs_zpool_fragmentation'                 # Fragmentation %, alert fires > 50
toolkit gf query 'zfs_zpool_capacity_used_ratio'           # Pool utilization
toolkit gf query 'node_zfs_arc_hits / (node_zfs_arc_hits + node_zfs_arc_misses)'   # ARC hit rate
```

### Velero Backups

```bash
velero backup get                      # Recent backup status
velero schedule get                    # Backup schedule health
```

Flag: failed backups, backup item errors, schedules not running on time.

### PV Utilization

```bash
toolkit gf query 'kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes > 0.85'
```

## Section 6: Monitoring Stack Health

### Firing Alerts

```bash
toolkit gf alerts                                          # Grafana alert rules
toolkit gf query 'ALERTS{alertstate="firing"}'             # All firing Prometheus alerts
```

### PagerDuty Incidents

```bash
toolkit pd incidents                                       # Open incidents (triggered + acknowledged)
toolkit pd incidents --status triggered                    # Triggered only (unacknowledged)
```

For any open incident, get details and timeline:

```bash
toolkit pd incident <INCIDENT_ID>                          # Details, notes, timeline
```

Flag: any triggered (unacknowledged) incidents, incidents open for >24h, incidents without notes.

### Scrape Targets

```bash
toolkit gf query 'up == 0'                                 # Any scrape targets down
```

### Recent Error Logs (Loki)

```bash
toolkit gf logs '{namespace=~".+"} |= "error"' --limit 30
toolkit gf logs '{namespace=~".+"} |= "CrashLoopBackOff"' --limit 10
```

## Section 7: Hardware / Physical Health

### SMART Disk Status

The cluster's custom smartmon textfile exporter emits metrics under
the `smartmon:*` prefix (colon separator = Prometheus recording rule).
See `packages/homelab/src/cdk8s/src/resources/monitoring/smartmon.sh`.

```bash
toolkit gf query 'smartmon:device_healthy'                # 1 = PASSED, 0 = FAILED
toolkit gf query 'smartmon_temperature_celsius_raw_value' # Disk temp
toolkit gf query 'smartmon_reallocated_sector_ct_raw_value > 0'
```

### NVMe Health

Emitted by the `nvme-metrics-collector` DaemonSet in `prometheus` ns.

```bash
toolkit gf query 'nvme_available_spare_ratio'             # Spare block health
toolkit gf query 'nvme_percentage_used_ratio'             # Wear level (0-1)
toolkit gf query 'nvme_composite_temperature_celsius'     # Controller temp
```

### CPU Thermals

```bash
toolkit gf query 'node_hwmon_temp_celsius'
toolkit gf query 'rate(node_cpu_core_throttles_total[5m]) > 0'   # Thermal throttling
```

## Section 8: Network & Ingress

```bash
kubectl get pods -n tailscale                              # Tailscale operator + ProxyGroup proxies health
kubectl get certificates -A                                # Cert-manager certificate status
kubectl get connectors,proxygroups,proxyclasses.tailscale.com -A   # Tailscale CRDs (ingress is modeled per-service via these)
```

Note: this cluster uses the `tailscale.com/v1alpha1` ProxyGroup model
(one `ts-*-ingress-*-0` pod per exposed service in the `tailscale`
namespace); the legacy `tailscaleingress` CRD is NOT installed. If
you were expecting to see TailscaleIngress resources, check pods and
`Connector`/`ProxyGroup` CRs instead.

Flag: expired or soon-to-expire certificates, Tailscale operator not running, any `ts-*-ingress-*-0` pod not Ready.

## Section 9: Error Tracking (Bugsink)

### Unresolved Issues

```bash
toolkit bugsink projects                                   # List all projects
toolkit bugsink issues                                     # All unresolved issues
toolkit bugsink issues --project <slug>                    # Per-project unresolved issues
```

For any high-event-count or recently active issues:

```bash
toolkit bugsink issue <ISSUE_UUID>                         # Issue details + latest event
toolkit bugsink stacktrace <EVENT_UUID>                    # Stacktrace for root cause analysis
```

Flag: new issues since last audit, issues with rapidly growing event counts, regressions (previously resolved issues reappearing).

### Recent Releases

```bash
toolkit bugsink releases --project <slug>                  # Check release tracking is current
```

Flag: projects with no recent releases (SDK may not be reporting), large gap between deploy and release record.

## Section 10: Temporal Workflows

Temporal runs in the `temporal` namespace (server + UI + worker + PostgreSQL). The UI is at `https://temporal-ui.tailnet-1a49.ts.net`. Workflow source is in `packages/temporal/` (`good-night`, `good-morning`, `golink-sync`, `fetcher`, `dns-audit`, `deps-summary`).

`TailscaleIngress` only proxies HTTP, so the gRPC frontend (port 7233) is not exposed through Tailscale. Use one of the following to talk to it:

```bash
# Option A — kubectl exec (runs temporal CLI inside the server pod; no network setup needed)
kubectl exec -n temporal deploy/temporal-temporal-server -- \
  temporal --address temporal-temporal-server-service:7233 operator cluster health

# Option B — kubectl port-forward
kubectl port-forward -n temporal svc/temporal-temporal-server-service 7233:7233 &
export TEMPORAL_ADDRESS=localhost:7233
# ... run temporal commands ...
# kill %1   # stop port-forward when done
```

The examples below assume `TEMPORAL_ADDRESS` is set (Option B) or are prefixed with `kubectl exec ...` (Option A).

### Cluster & pod health

```bash
kubectl get pods -n temporal                              # server, ui, worker, postgresql all Running
kubectl get deploy,sts -n temporal                        # replica readiness
argocd app get temporal                                   # sync status / SyncError messages
```

Flag: any pod not Running/Ready, `CreateContainerConfigError` (missing secret — often a 1Password Connect sync issue), ArgoCD app Degraded or OutOfSync with SyncError.

### Temporal frontend health

```bash
temporal operator cluster health                          # gRPC ping to frontend (expect SERVING)
temporal operator namespace list                          # expected namespaces (default)
```

Flag: non-SERVING status, gRPC connection error despite server pods Running (NetworkPolicy change, service endpoint mismatch), missing `default` namespace.

### Failed or stuck workflow executions

The Temporal CLI requires RFC3339 timestamps in query clauses. Compute them inline with `date`:

```bash
# 24h ago, RFC3339 UTC. macOS uses -v; GNU date uses -d.
DAY_AGO="$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)"

# Workflows that failed in the last 24h
temporal workflow list --query "ExecutionStatus='Failed' AND CloseTime > '${DAY_AGO}'"

# Running executions older than a day (possible stuck)
temporal workflow list --query "ExecutionStatus='Running' AND StartTime < '${DAY_AGO}'"

# Terminated / Canceled / TimedOut recently
temporal workflow list --query "ExecutionStatus IN ('Terminated','Canceled','TimedOut') AND CloseTime > '${DAY_AGO}'"

# Drill into a specific execution
temporal workflow describe --workflow-id <WF_ID>
temporal workflow show     --workflow-id <WF_ID>         # full event history
```

Flag: any recently-failed workflow, Running executions older than a day, Terminated executions not initiated by a known deploy/rotation.

### Schedule health

```bash
temporal schedule list                                    # one row per scheduled workflow
temporal schedule describe --schedule-id <SCHED_ID>       # recent actions + next fire time
```

Flag: schedules with empty recent actions (never fired), paused without a documented reason, next fire time in the past.

### Prometheus view

```bash
toolkit gf query 'rate(temporal_workflow_execution_failed_total[15m])'
toolkit gf query 'temporal_workflow_task_timeout_count'
toolkit gf query 'up{namespace="temporal"}'
```

Flag: non-zero failure rate, scrape target down.

## Section 11: CI on `main`

Buildkite is the source of truth for CI (pipeline `sjerred/monorepo`). **Do not use `gh run`** — this repo does not use GitHub Actions. Requires `BUILDKITE_API_TOKEN` in env; the `sjerred` org must be configured (`bk configure --org sjerred --token $BUILDKITE_API_TOKEN`) and selected (`bk use sjerred`).

### Is `main` green?

```bash
bk build list --pipeline monorepo --branch main --limit 5                  # last 5 builds on main
bk build list --pipeline monorepo --branch main --state failed --since 24h # recent failures on main
bk build view --pipeline monorepo <BUILD_NUMBER>                           # details + failing job output
```

Flag: latest `main` build `failed` / `canceled` / `blocked`, or a sustained streak of failures (a red `main` means deploys are stale — last-green image is still running).

### In-flight builds

```bash
bk build list --pipeline monorepo --state running --limit 20               # currently running
bk build list --pipeline monorepo --state scheduled --limit 20             # queued / waiting for agents
```

Flag: builds running >60 min (stuck), scheduled builds piling up (agent starvation — cross-check agent pool below).

### Agent pool

```bash
kubectl get pods -n buildkite                             # agent stack controller + active agents
bk agent list                                             # connected agents
```

Flag: agent controller pod not Running, zero connected agents while builds are scheduled.

## Section 12: Open Pull Requests

Long-lived, conflicted, or CI-failing PRs block releases and rot quickly. Check these even when `main` is green.

### PR inventory & CI rollup

```bash
gh pr list --state open --limit 50 \
  --json number,title,author,isDraft,mergeable,updatedAt,headRefName,statusCheckRollup

gh pr list --state open --search "draft:false" \
  --json number,title,updatedAt,mergeable,statusCheckRollup
```

Flag: `mergeable: "CONFLICTING"`, `statusCheckRollup` containing `FAILURE`, PRs older than ~14 days (stale), non-draft PRs with no reviewer activity.

### Deep per-PR health

For any PR flagged above:

```bash
toolkit pr health <PR_NUMBER>                             # bundled conflicts + CI + approval check
toolkit pr logs <RUN_ID>                                  # Buildkite logs for the failing check
```

Flag: merge conflicts against `main`, failing required checks, missing approvals on a PR otherwise ready.

### Renovate / automation PRs

```bash
gh pr list --state open --author "app/renovate" --json number,title,mergeable,statusCheckRollup
```

Flag: Renovate PRs with failing CI (broken upgrade pipeline), or a large backlog of open Renovate PRs (automerge broken).

## Output Format

Compile findings into a structured report with:

| Severity             | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| **Red / Critical**   | Service down, data loss risk, immediate action needed |
| **Yellow / Warning** | Degraded but functional, action needed soon           |
| **Green / Healthy**  | Operating normally                                    |

Include for each issue:

- What is wrong (specific resource, namespace, error)
- Evidence (metric value, log snippet, event)
- Recommended action

End with a "What's Working Well" section to confirm healthy systems.

## Cross-Validation

- ArgoCD status should match actual pod status (OutOfSync app but pods running = just pending sync)
- Prometheus alerts should match observed issues (if alert fires but issue is gone, check alert duration)
- Backup recency should match schedule (if schedule says daily but last backup is 3 days old, investigate)
- PagerDuty incidents should correlate with firing alerts (open incident without firing alert = stale incident; firing alert without incident = missing integration)
- Bugsink issues should correlate with pod health (CrashLoopBackOff pods should have corresponding error events in Bugsink)
- Bugsink releases should match recent deployments (if ArgoCD synced a new version but no Bugsink release exists, SDK integration may be misconfigured)
- Temporal workflow failures should correlate with pod health: if workflows error out while `temporal-worker` pods are Healthy, check `kubectl logs -n temporal -l app=temporal-worker` — the worker is running but the workflow/activity code is failing
- Red `main` CI should correlate with ArgoCD state for any auto-synced app tracking `main` — if `main` is red but ArgoCD is Synced and Healthy, the deployed image is the last green build (not the tip of `main`)
- PR `statusCheckRollup` failures on Buildkite checks should match `bk build list` output for that commit; a mismatch means GitHub's check status is stale and a re-run may be needed
