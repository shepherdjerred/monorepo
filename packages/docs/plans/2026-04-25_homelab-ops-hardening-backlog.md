# Homelab Ops Hardening Backlog

## Status

Active. Extracted from the archived 2026-04-05 homelab ops audit after several findings became stale or partially fixed.

## Current Focus

- Add missing health probes and resource requests/limits for long-running workloads.
- Improve disaster recovery: PostgreSQL WAL/PITR, restore runbooks, and periodic restore tests.
- Replace remaining floating versions such as `latest` and broad chart/image pins where local evidence shows drift risk.
- Re-audit monitoring dashboards and alert coverage before changing alert policy.

## Not In Scope

- Rewriting the full historical audit.
- Treating every 2026-04-05 scorecard item as current without a fresh code or cluster check.

## Acceptance

- Each implementation PR references one narrow backlog item.
- Any completed item is verified against the current cdk8s/OpenTofu source before being marked done.
