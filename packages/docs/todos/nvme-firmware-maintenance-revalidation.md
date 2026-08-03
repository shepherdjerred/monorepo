---
id: nvme-firmware-maintenance-revalidation
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/2026-05-10_firmware-update-runbook.md
---

# Revalidate NVMe firmware maintenance against the current cluster

## Context

The 2026-05-10 operator runbook is unsafe for the current topology: it assumes Talos 1.12, a single node, and a Dagger namespace. Current source uses Talos 1.13.7 with torvalds and liskov, and the old Dagger workload is gone.

## Remaining

- [ ] Read current NVMe firmware, drive health, storage topology, workload placement, disruption constraints, and backup state without mutating the cluster.
- [ ] Confirm whether a firmware update is still applicable and identify the vendor-supported upgrade method for the exact current drives.
- [ ] Write a fresh topology-aware operator guide with rollback, drain/failover, storage, Buildkite-capacity, and post-reboot verification steps.
- [ ] Split the actual privileged maintenance window into a blocked operator todo; archive this revalidation item after the guide is reviewed.

## Comment Log

### 2026-08-02 — replaced stale runbook

- Archived the old single-node Talos 1.12 procedure without executing it.

## Session Log — 2026-08-02

### Done

- Turned an unsafe operator card into an agent-operable read-only revalidation task.

### Remaining

- Produce a current runbook and a separately authorized maintenance card.

### Caveats

- This todo authorizes assessment and documentation only, not firmware changes, reboots, drains, or storage mutations.
