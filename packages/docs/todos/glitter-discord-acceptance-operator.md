---
id: glitter-discord-acceptance-operator
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-07-26_glitter-discord-source-of-truth.md
---

# Provision and acceptance-test the Glitter Discord corpus pipeline

## Context

The code path is intentionally paused and inventory-approval-gated. Live
acceptance requires seven restricted Discord/R2 fields, 1Password snapshot
refresh, and authorization before any history request.

## Remaining

- [ ] Populate the approved 1Password fields, refresh the non-secret snapshot, and record explicit channel/thread scope approval.
- [ ] Run the controlled Discord canary, mirrored publication, Temporal, SeaweedFS, R2 recovery, and pull-request acceptance sequence.
- [ ] Record checksums and outcomes, then unpause only the approved schedule scope.

## Comment Log

### 2026-07-27 — split from active implementation plan

- Privileged credentials and live Discord/storage operations are operator work, not human UAT or agent verification.
