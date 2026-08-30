---
title: SeaweedFS off-site backups
description: Protected buckets, recovery-point retention, worker boundaries, metrics, and alerts for the SeaweedFS-to-R2 backup system.
sidebar:
  order: 19
---

SeaweedFS object data is backed up incrementally to the WNAM Standard-class R2
bucket `seaweedfs-backups`. Raw SeaweedFS PersistentVolumeClaims remain excluded
from Velero. Immutable manifests provide recovery points while unchanged object
payloads are stored once.

## Coverage

| Source                                                     | Cadence                   | Notes                                       |
| ---------------------------------------------------------- | ------------------------- | ------------------------------------------- |
| `homelab-tofu-state`, `relay-docs`                         | Every six hours and daily | Critical state                              |
| `glitter-discord-corpus`, `llm-archive`, `temporal-worker` | Daily                     | All objects                                 |
| `scout-prod`, `scout-beta`                                 | Daily                     | `.png` and `.svg` are excluded derived data |

Every other live bucket has an explicit excluded policy with a reason in
`packages/seaweedfs-backup/policy.json`. An unclassified live bucket is coverage
drift; a missing protected bucket is a critical failure.

## Recovery points

The six-hourly tier keeps the newest 28 points. Daily runs supply the GFS tiers,
selected at Pacific calendar boundaries:

- 30 daily points
- 8 weekly points
- 12 monthly points

Each source bucket has a gzip-compressed NDJSON manifest. A run is visible only
after every selected bucket succeeds and its completion marker is published.
Deleted and overwritten payloads remain protected while any retained manifest
references them.

R2 locks `objects/` and `snapshots/` for 30 days. Garbage collection first
records objects that have been unreferenced for at least 35 days. A later run,
at least seven days afterward, rebuilds the retained protection set and deletes
only candidates that are still unreferenced, unchanged, and no longer locked.
Any revalidation failure stops deletion.

## Runtime boundary

The `backup` Temporal worker owns the dedicated `backup` activity queue with
activity concurrency one. It has no Kubernetes service-account token. Its
single 1Password item contains read-only SeaweedFS credentials and R2
credentials scoped to `seaweedfs-backups`; restore credentials are not mounted
into the worker.

The three Temporal schedules are initially paused:

| Schedule                               | Pacific time    |
| -------------------------------------- | --------------- |
| `seaweedfs-backup-six-hourly`          | Every six hours |
| `seaweedfs-backup-daily`               | 11:30 daily     |
| `seaweedfs-backup-retention-gc-weekly` | 14:00 Sunday    |

## Monitoring

The **SeaweedFS - Off-site Backup** Grafana dashboard shows freshness, current
stage, run duration, source and protected bytes, copied and reused objects,
transfer bytes, verification results, retention counts, GC backlog, R2 growth,
and projected monthly Standard storage cost.

Prometheus alerts cover six-hourly and daily freshness, integrity failure,
coverage drift, protected bucket disappearance, retention shortfall after
warm-up, stuck GC candidates, GC revalidation failure, R2 bucket-lock drift,
cost above $10/month, R2 capacity, and exporter health. Temporal's failure
watcher supplies the exact workflow error and run link. Structured worker logs
include snapshot IDs and aggregate counts, never object keys.

There is no scheduled restore canary. The initial rollout includes one
acceptance restore; later restores are operator-initiated.

## Related

- [Restore a SeaweedFS backup](/how-to/restore-a-seaweedfs-backup/)
- [Temporal workflow families](/explanation/temporal/workflow-families/)
- [How the homelab is put together](/explanation/homelab/overview/)
