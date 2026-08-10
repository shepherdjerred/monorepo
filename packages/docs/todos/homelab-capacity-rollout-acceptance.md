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
  "title": "Capture homelab capacity deployment baseline",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-12T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/todos/homelab-capacity-rollout-acceptance.md"
  },
  "prompt": "Read this TODO and its origin plan. Inspect Buildkite, ArgoCD, Kubernetes, Kueue, Prometheus, Grafana, Temporal schedules, PVCs, ZFS, SMART/NVMe, and liskov thermals read-only. Confirm the deployed Git revision; effective max-in-flight and Kueue quotas; every changed workload and Tailscale proxy request; Turbo cleanup schedule and secret mount without exposing secret values; predictive rules; dashboard provisioning; current OOM, eviction, pressure, admission, MemAvailable, disk-I/O, SSD-write, and AMD Tctl evidence. Run the Grafana dashboard query audit and require zero invalid queries. Report exact values, timestamps, query windows, and any unverified Talos-only evidence. Do not edit files, mutate the cluster, trigger CI, or send anything except the report email."
}
-->

<!-- temporal-agent-task
{
  "title": "Check homelab capacity rollout after 24 hours",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-13T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/todos/homelab-capacity-rollout-acceptance.md"
  },
  "prompt": "Read this TODO and its origin plan. Using read-only Buildkite, Kubernetes, Kueue, Prometheus, Grafana, ArgoCD, Temporal, ZFS, and SMART/NVMe evidence, evaluate the first 24 hours after the deployed rollout revision: Kueue admission p50/p95/p99 and backlog, limiter queue delay and concurrency mix, OOMs/restarts/evictions/node pressure, minimum liskov MemAvailable, disk-I/O p95/p99, AMD Tctl current/p95/p99/max and time above 90/94/95C, SSD write and health alerts, PVC growth, Turbo cleanup success/deleted/scanned metrics, and invalid Grafana queries. Separate missing evidence from passing evidence and name any rollback gate that failed. Do not edit files, mutate systems, trigger CI, or send anything except the report email."
}
-->

<!-- temporal-agent-task
{
  "title": "Check homelab capacity rollout after seven days",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-19T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
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
