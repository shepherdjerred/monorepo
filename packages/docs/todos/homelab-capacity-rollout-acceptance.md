---
id: homelab-capacity-rollout-acceptance
type: todo
status: in-progress
board: true
verification: human
disposition: active
origin: packages/docs/plans/2026-08-09_homelab-capacity-right-sizing-remediation.md
source_marker: false
---

# Accept the homelab capacity right-sizing rollout

The source, CI, deployment, and automated evidence gathering remain
agent-owned. Human acceptance is required only after the deployment, 24-hour,
and seven-day report-only checks all contain enough evidence to evaluate every
gate below.

The `runAt` values assume the planned 2026-08-12 09:00 Pacific deployment
window. If the cooler inspection, CI, or deployment moves, update all three
timestamps in the still-open implementation PR before scheduling these tasks.
Do not schedule them until the implementation is on `main` and ArgoCD has begun
the coordinated rollout.

## Remaining

- [ ] Complete the separate cooling-inspection prerequisite, merge the green
      implementation PR, and verify the coordinated ArgoCD rollout revision.
- [ ] Schedule all three report-only tasks for the actual deployment window.
- [ ] Confirm the deployment, 24-hour, and seven-day reports contain evidence
      for every acceptance gate.
- [ ] Move this TODO to `awaiting-human` only after those reports are complete.

## Scheduled evidence

Schedule each block after deployment begins with:

The scheduler honors `TEMPORAL_TLS=true` through the shared validated Temporal
connection options used by the production canary.

```bash
cd packages/temporal
TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 TEMPORAL_TLS=true \
  bun run scripts/schedule-agent-task.ts \
  --from-doc ../../packages/docs/todos/homelab-capacity-rollout-acceptance.md
```

<!-- temporal-agent-task
{
  "contractVersion": 2,
  "title": "Capture homelab capacity deployment baseline",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-12T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "checks": [
    { "id": "deployed-revision", "label": "Deployed revision", "required": true, "evidenceRequirement": "The checkout is readable and the root ArgoCD application is synced and healthy.", "evidenceCollectors": [{ "id": "git-revision", "kind": "command", "argv": ["git", "rev-parse", "HEAD"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "argocd-root", "kind": "command", "argv": ["argocd", "app", "get", "apps", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["status", "sync", "status"], "operator": "eq", "expected": "Synced", "quantifier": "all" }, { "path": ["status", "health", "status"], "operator": "eq", "expected": "Healthy", "quantifier": "all" }] } }] },
    { "id": "capacity-runtime", "label": "Capacity and runtime health", "required": true, "evidenceRequirement": "Buildkite, Kueue, and Temporal queries succeed and every Kubernetes pod is Running or Succeeded.", "evidenceCollectors": [{ "id": "main-builds", "kind": "command", "argv": ["bk", "build", "list", "--pipeline", "monorepo", "--branch", "main", "--limit", "5"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "workloads", "kind": "command", "argv": ["kubectl", "get", "pods", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["items", "*", "status", "phase"], "operator": "in", "expected": ["Running", "Succeeded"], "quantifier": "all" }] } }, { "id": "kueue-state", "kind": "command", "argv": ["kubectl", "get", "clusterqueues.kueue.x-k8s.io,localqueues.kueue.x-k8s.io", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "temporal-schedules", "kind": "command", "argv": ["temporal", "schedule", "list", "--output", "json"], "output": "json", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }] },
    { "id": "observability", "label": "Metrics and dashboards", "required": true, "evidenceRequirement": "No Buildkite backlog or recent pod restart is present, liskov has at least 16Gi available, and the dashboard audit succeeds.", "evidenceCollectors": [{ "id": "kueue-backlog", "kind": "prometheus", "query": "sum(kueue_pending_workloads{cluster_queue=\"buildkite\"})", "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0, "quantifier": "all" } }, { "id": "liskov-memory", "kind": "prometheus", "query": "node_memory_MemAvailable_bytes{node=\"liskov\"}", "expectation": { "kind": "numeric", "operator": "gte", "threshold": 17179869184, "quantifier": "all" } }, { "id": "pod-restarts", "kind": "prometheus", "query": "sum(increase(kube_pod_container_status_restarts_total[5m]))", "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0, "quantifier": "all" } }, { "id": "dashboard-audit", "kind": "command", "argv": ["bun", "packages/homelab/src/cdk8s/scripts/grafana-dashboard-audit.ts"], "output": "json", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }] },
    { "id": "storage-thermals", "label": "Storage and thermals", "required": true, "evidenceRequirement": "Every PVC is bound, ZFS is healthy, disk I/O is at most 70%, and AMD Tctl is at most 95C.", "evidenceCollectors": [{ "id": "pvc-inventory", "kind": "command", "argv": ["kubectl", "get", "pvc", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["items", "*", "status", "phase"], "operator": "eq", "expected": "Bound", "quantifier": "all" }] } }, { "id": "zpool-status", "kind": "command", "argv": ["zpool", "status", "-x"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "disk-io", "kind": "prometheus", "query": "rate(node_disk_io_time_seconds_total{node=\"liskov\"}[5m])", "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0.7, "quantifier": "all" } }, { "id": "amd-tctl", "kind": "prometheus", "query": "node_hwmon_temp_celsius{node=\"liskov\"} and on(chip,sensor) node_hwmon_sensor_label{node=\"liskov\",label=\"Tctl\"}", "expectation": { "kind": "numeric", "operator": "lte", "threshold": 95, "quantifier": "all" } }] }
  ],
  "source": {
    "docPath": "packages/docs/todos/homelab-capacity-rollout-acceptance.md"
  },
  "prompt": "Read this TODO and its origin plan. Inspect Buildkite, ArgoCD, Kubernetes, Kueue, Prometheus, Grafana, Temporal schedules, PVCs, ZFS, SMART/NVMe, and liskov thermals read-only. Confirm the deployed Git revision; effective max-in-flight and Kueue quotas; every changed workload and Tailscale proxy request; Turbo cleanup schedule and secret mount without exposing secret values; predictive rules; dashboard provisioning; current OOM, eviction, pressure, admission, MemAvailable, disk-I/O, SSD-write, and AMD Tctl evidence. Run the Grafana dashboard query audit and require zero invalid queries. Report exact values, timestamps, query windows, and any unverified Talos-only evidence. Do not edit files, mutate the cluster, trigger CI, or send anything except the report email."
}
-->

<!-- temporal-agent-task
{
  "contractVersion": 2,
  "title": "Check homelab capacity rollout after 24 hours",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-13T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "checks": [
    { "id": "deployed-revision", "label": "Deployed revision and window", "required": true, "evidenceRequirement": "The checkout is readable and the root ArgoCD application is synced and healthy.", "evidenceCollectors": [{ "id": "git-revision", "kind": "command", "argv": ["git", "rev-parse", "HEAD"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "argocd-root", "kind": "command", "argv": ["argocd", "app", "get", "apps", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["status", "sync", "status"], "operator": "eq", "expected": "Synced", "quantifier": "all" }, { "path": ["status", "health", "status"], "operator": "eq", "expected": "Healthy", "quantifier": "all" }] } }] },
    { "id": "capacity-runtime", "label": "Capacity and runtime gates", "required": true, "evidenceRequirement": "Buildkite and Kueue queries succeed, pods are Running or Succeeded, and admission p95 stays at or below five seconds.", "evidenceCollectors": [{ "id": "main-builds", "kind": "command", "argv": ["bk", "build", "list", "--pipeline", "monorepo", "--branch", "main", "--limit", "20"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "workloads", "kind": "command", "argv": ["kubectl", "get", "pods", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["items", "*", "status", "phase"], "operator": "in", "expected": ["Running", "Succeeded"], "quantifier": "all" }] } }, { "id": "kueue-state", "kind": "command", "argv": ["kubectl", "get", "clusterqueues.kueue.x-k8s.io,localqueues.kueue.x-k8s.io", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "admission-p95", "kind": "prometheus", "query": "histogram_quantile(0.95, sum by (le) (rate(kueue_admission_wait_time_seconds_bucket{cluster_queue=\"buildkite\"}[30m])))", "windowSeconds": 86400, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 5, "quantifier": "all" } }] },
    { "id": "observability", "label": "Metrics and dashboards", "required": true, "evidenceRequirement": "Across 24 hours there is no backlog or five-minute restart increase, liskov stays above 16Gi available, and the dashboard audit succeeds.", "evidenceCollectors": [{ "id": "kueue-backlog", "kind": "prometheus", "query": "sum(kueue_pending_workloads{cluster_queue=\"buildkite\"})", "windowSeconds": 86400, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0, "quantifier": "all" } }, { "id": "liskov-memory", "kind": "prometheus", "query": "node_memory_MemAvailable_bytes{node=\"liskov\"}", "windowSeconds": 86400, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "gte", "threshold": 17179869184, "quantifier": "all" } }, { "id": "pod-restarts", "kind": "prometheus", "query": "sum(increase(kube_pod_container_status_restarts_total[5m]))", "windowSeconds": 86400, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0, "quantifier": "all" } }, { "id": "dashboard-audit", "kind": "command", "argv": ["bun", "packages/homelab/src/cdk8s/scripts/grafana-dashboard-audit.ts"], "output": "json", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }] },
    { "id": "storage-thermals", "label": "Storage and thermals", "required": true, "evidenceRequirement": "Across 24 hours every PVC is bound, ZFS is healthy, disk I/O is at most 70%, and AMD Tctl is at most 95C.", "evidenceCollectors": [{ "id": "pvc-inventory", "kind": "command", "argv": ["kubectl", "get", "pvc", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["items", "*", "status", "phase"], "operator": "eq", "expected": "Bound", "quantifier": "all" }] } }, { "id": "zpool-status", "kind": "command", "argv": ["zpool", "status", "-x"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "disk-io", "kind": "prometheus", "query": "rate(node_disk_io_time_seconds_total{node=\"liskov\"}[5m])", "windowSeconds": 86400, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0.7, "quantifier": "all" } }, { "id": "amd-tctl", "kind": "prometheus", "query": "node_hwmon_temp_celsius{node=\"liskov\"} and on(chip,sensor) node_hwmon_sensor_label{node=\"liskov\",label=\"Tctl\"}", "windowSeconds": 86400, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 95, "quantifier": "all" } }] }
  ],
  "source": {
    "docPath": "packages/docs/todos/homelab-capacity-rollout-acceptance.md"
  },
  "prompt": "Read this TODO and its origin plan. Using read-only Buildkite, Kubernetes, Kueue, Prometheus, Grafana, ArgoCD, Temporal, ZFS, and SMART/NVMe evidence, evaluate the first 24 hours after the deployed rollout revision: Kueue admission p50/p95/p99 and backlog, limiter queue delay and concurrency mix, OOMs/restarts/evictions/node pressure, minimum liskov MemAvailable, disk-I/O p95/p99, AMD Tctl current/p95/p99/max and time above 90/94/95C, SSD write and health alerts, PVC growth, Turbo cleanup success/deleted/scanned metrics, and invalid Grafana queries. Separate missing evidence from passing evidence and name any rollback gate that failed. Do not edit files, mutate systems, trigger CI, or send anything except the report email."
}
-->

<!-- temporal-agent-task
{
  "contractVersion": 2,
  "title": "Check homelab capacity rollout after seven days",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-19T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "checks": [
    { "id": "deployed-revision", "label": "Deployed revision and soak window", "required": true, "evidenceRequirement": "The checkout is readable and the root ArgoCD application is synced and healthy.", "evidenceCollectors": [{ "id": "git-revision", "kind": "command", "argv": ["git", "rev-parse", "HEAD"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "argocd-root", "kind": "command", "argv": ["argocd", "app", "get", "apps", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["status", "sync", "status"], "operator": "eq", "expected": "Synced", "quantifier": "all" }, { "path": ["status", "health", "status"], "operator": "eq", "expected": "Healthy", "quantifier": "all" }] } }] },
    { "id": "capacity-runtime", "label": "Capacity and runtime gates", "required": true, "evidenceRequirement": "Buildkite and Kueue queries succeed, pods are Running or Succeeded, and admission p95 stays at or below five seconds.", "evidenceCollectors": [{ "id": "main-builds", "kind": "command", "argv": ["bk", "build", "list", "--pipeline", "monorepo", "--branch", "main", "--limit", "50"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "workloads", "kind": "command", "argv": ["kubectl", "get", "pods", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["items", "*", "status", "phase"], "operator": "in", "expected": ["Running", "Succeeded"], "quantifier": "all" }] } }, { "id": "kueue-state", "kind": "command", "argv": ["kubectl", "get", "clusterqueues.kueue.x-k8s.io,localqueues.kueue.x-k8s.io", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "admission-p95", "kind": "prometheus", "query": "histogram_quantile(0.95, sum by (le) (rate(kueue_admission_wait_time_seconds_bucket{cluster_queue=\"buildkite\"}[30m])))", "windowSeconds": 604800, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 5, "quantifier": "all" } }] },
    { "id": "observability", "label": "Metrics and dashboards", "required": true, "evidenceRequirement": "Across seven days there is no backlog or five-minute restart increase, liskov stays above 16Gi available, and the dashboard audit succeeds.", "evidenceCollectors": [{ "id": "kueue-backlog", "kind": "prometheus", "query": "sum(kueue_pending_workloads{cluster_queue=\"buildkite\"})", "windowSeconds": 604800, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0, "quantifier": "all" } }, { "id": "liskov-memory", "kind": "prometheus", "query": "node_memory_MemAvailable_bytes{node=\"liskov\"}", "windowSeconds": 604800, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "gte", "threshold": 17179869184, "quantifier": "all" } }, { "id": "pod-restarts", "kind": "prometheus", "query": "sum(increase(kube_pod_container_status_restarts_total[5m]))", "windowSeconds": 604800, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0, "quantifier": "all" } }, { "id": "dashboard-audit", "kind": "command", "argv": ["bun", "packages/homelab/src/cdk8s/scripts/grafana-dashboard-audit.ts"], "output": "json", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }] },
    { "id": "storage-thermals", "label": "Storage and thermals", "required": true, "evidenceRequirement": "Across seven days every PVC is bound, ZFS is healthy, disk I/O is at most 70%, and AMD Tctl is at most 95C.", "evidenceCollectors": [{ "id": "pvc-inventory", "kind": "command", "argv": ["kubectl", "get", "pvc", "-A", "-o", "json"], "output": "json", "expectation": { "kind": "json", "assertions": [{ "path": ["items", "*", "status", "phase"], "operator": "eq", "expected": "Bound", "quantifier": "all" }] } }, { "id": "zpool-status", "kind": "command", "argv": ["zpool", "status", "-x"], "output": "non-empty", "expectation": { "kind": "exit-code", "passedExitCodes": [0] } }, { "id": "disk-io", "kind": "prometheus", "query": "rate(node_disk_io_time_seconds_total{node=\"liskov\"}[5m])", "windowSeconds": 604800, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 0.7, "quantifier": "all" } }, { "id": "amd-tctl", "kind": "prometheus", "query": "node_hwmon_temp_celsius{node=\"liskov\"} and on(chip,sensor) node_hwmon_sensor_label{node=\"liskov\",label=\"Tctl\"}", "windowSeconds": 604800, "stepSeconds": 300, "expectation": { "kind": "numeric", "operator": "lte", "threshold": 95, "quantifier": "all" } }] }
  ],
  "source": {
    "docPath": "packages/docs/todos/homelab-capacity-rollout-acceptance.md"
  },
  "prompt": "Read this TODO and its origin plan. Evaluate the complete seven-day soak for the exact deployed revision using read-only Buildkite, Kubernetes, Kueue, Prometheus, Grafana, ArgoCD, Temporal, ZFS, and SMART/NVMe evidence. Report Kueue admission p50/p95/p99, pending and inadmissible backlog, observed CI mixes, limiter queue delay, OOMs/restarts/evictions/node pressure, minimum liskov MemAvailable, disk-I/O p95/p99, AMD Tctl p95/p99/max plus time above 90/94/95C, SSD lifetime and seven-day writes plus health alerts, PVC growth/runway, and all Turbo cleanup outcomes. Run the Grafana dashboard query audit and require zero invalid queries. Give an explicit pass, fail, or insufficient-evidence result for every Human Verification gate, but do not accept the rollout for the human. Do not edit files, mutate systems, trigger CI, or send anything except the report email."
}
-->

## Human Verification

After all three reports arrive, inspect their linked raw evidence and explicitly
accept or reject the rollout:

- Admission p95 is at or below five seconds under ordinary mixed CI.
- There were no OOMs, evictions, or node-pressure conditions.
- liskov MemAvailable never fell below 16Gi.
- Disk-I/O p99 stayed at or below 70%.
- SSD write/health alerts did not regress.
- AMD Tctl did not stay above 95 degrees Celsius for five minutes.
- The Grafana audit reports zero invalid dashboard queries.
- Turbo cleanup succeeded at least daily without exposing its token and only
  deleted rebuildable entries older than 30 days.

Reject the rollout if any gate fails or evidence is insufficient. Restore cap
20 and affected reservations through the emergency GitOps revert; disable
Turbo cleanup independently if it is the only failing component.

## Comment Log

### 2026-08-09 — acceptance checks prepared

- Created the human-acceptance boundary and three report-only checks for the
  planned deployment, 24-hour, and seven-day evidence windows.
- Scheduling remains gated on green CI, completed cooler inspection, and the
  exact deployment window.

### 2026-08-09 — kept active through automated verification

- Kept the TODO `in-progress` while deployment and all three report-only checks
  remain agent-operable work. Human acceptance begins only after their evidence
  is complete.
