---
id: plan-2026-04-25-homelab-ops-hardening-backlog
type: plan
status: planned
board: true
verification: agent
disposition: deferred
---

# Homelab Ops Hardening Backlog

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

## Remaining

- [ ] Re-audit current long-running workloads and file narrow TODOs only for missing probes or resource bounds that still exist.
- [ ] File separate TODOs for any confirmed PostgreSQL PITR/restore-test gap and any currently floating production pin.
- [ ] Archive this umbrella after every confirmed residual has a narrow owner.

## Session Log — 2026-07-27

### Done

- The document is a generic backlog, not an executing implementation; every item requires a fresh source or cluster check before work is accepted.

### Remaining

- See the current `## Remaining` checklist above.

### Caveats

- The 2026-07-27 board audit replaced generic or stale completion language with current ownership and verification semantics.
