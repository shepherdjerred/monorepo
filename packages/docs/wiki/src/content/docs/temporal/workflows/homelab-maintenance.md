---
title: Homelab maintenance workflows
description: Scheduled live maintenance — ZFS scrubs, error-DB housekeeping, backup-orphan detection, DNS audits, golink sync, Kometa, Buildkite cache maintenance, and PagerDuty alerts.
---

The maintenance fleet includes the cluster janitors, the serial Buildkite
cache/database activities, Kometa Plex synchronization, and a continuous
workflow-failure pager. The four Buildkite/Kometa workflows are direct
subprocess activities on the `maintenance` task queue. They run in one
persistent `temporal-maintenance-worker` Deployment in the `buildkite`
namespace, which mounts the existing Buildkite PVCs and has no Kubernetes Job
RBAC. Kometa reaches Plex over the cluster network; its config and credentials
are owned by the Buildkite chart. The one workflow that touches backups is
detection-only by explicit decision.

The remaining namespace-scoped `kubectl exec` RBAC belongs only to the older
ZFS, Bugsink, and Velero activities described below; it is unrelated to the
maintenance worker.

## Direct maintenance activities

- `kometa-daily` runs Kometa with the mounted `config.yml` and injected Plex/TMDB
  credentials.
- `buildkite-bun-cache-gc` runs the shared lock-aware Bun GC script against the
  Bun data and control PVCs.
- `buildkite-uv-cache-prune-weekly` runs `uv cache prune --ci` against the UV
  cache PVC.
- `buildkite-trivy-db-refresh` runs `trivy image --download-db-only` against
  the Trivy database PVC.

Temporal schedules retain their existing IDs and workflow names while routing
these activities to the serial `maintenance` queue. A failed subprocess is
retried by Temporal; no maintenance Kubernetes `Job` or `CronJob` is created.

## ZFS maintenance (`zfs-maintenance`)

Sunday 03:00. Execs into the zpool-collector DaemonSet to enable autotrim
and start a scrub on both OpenEBS pools (NVMe and HDD). Idempotent: a pool
already scrubbing is skipped, so retries and overlapping Sundays are safe.

## Bugsink housekeeping (`bugsink-housekeeping`)

Daily 03:00. Execs into the Bugsink pod: delete events older than 180 days,
then three vacuum passes. Uses `kubectl exec` rather than the Kubernetes
client's websocket exec because the latter fails opaquely under Bun.

## Velero orphan audit (`velero-orphan-audit`)

Daily 03:30 — staggered after backups settle. Lists live Velero `Backup`
CRs, runs `zfs list` on each OpenEBS node, and flags any PVC snapshot with no
matching live backup as an orphan. It **only detects**: Prometheus gauges per
dataset, a JSON summary for Loki, and a pointer to the remediation runbook.
Auto-pruning was considered and explicitly declined (2026-06-06) —
destructive automation aimed at backups is the one place detection confidence
isn't enough. The reasoning lives in
`packages/docs/decisions/2026-05-05_velero-orphan-snapshot-prevention.md`.

## DNS audit (`dns-audit`)

Daily 06:00. Checks SPF, DMARC, and MX records for the email domains and
confirms parked domains have no mail configuration, using plain `node:dns`.
Findings go to structured logs (Loki) — no email, no mutation.

## Golink sync (`golink-sync`)

Daily 05:00. Derives the expected set of `go/` short links from Tailscale
ingress hostnames (read-only ingress ClusterRole) and reconciles the golink
server: create, update, and delete — but **only links owned by the worker's
own tag identity**. Hand-curated links belong to human owners and are never
touched. A 20-second per-request timeout makes a broken tailnet path fail
fast instead of hanging the run (a lesson from an ACL outage).

## Temporal failure watch (`temporal-failure-watch`)

Every 5 minutes — the one non-nightly job here. Queries the Temporal
visibility API for executions that **failed or timed out** in the last 15
minutes and pages PagerDuty via Alertmanager, one alert per failed run
(labelled by workflow type and run ID so Alertmanager dedups). It backstops
the hand-maintained Prometheus rules: **every** workflow type pages on any
failure, not just those with a bespoke threshold. Stateless — no persisted
checkpoint, and the 15-minute lookback over a 5-minute cadence means a missed
tick can't open a gap.

Sources: [`src/activities/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/temporal/src/activities)
(one file per workflow); exec RBAC in
[`worker.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/temporal/worker.ts).
