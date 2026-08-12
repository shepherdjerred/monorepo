---
id: velero-r2-lifecycle-backstop
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/2026-06-28_velero-r2-tagging-outage.md
---

# Add an R2 lifecycle backstop for orphaned Velero data

## Context

The outage cleanup reclaimed the orphaned data, but the configured R2 identity
could not read or set bucket lifecycle rules. A lifecycle-capable credential is
a privileged prerequisite for the durable backstop.

## Remaining

- [ ] Provision or authorize an R2 credential with the minimum bucket-lifecycle permissions.
- [ ] Apply and read back a lifecycle rule scoped to the Velero `zfspv-incr/` prefix, then record the effective rule and retention window.

## Comment Log

### 2026-08-11 — guarded manual remediation retained

- Added a two-phase R2 orphan cleanup tool with a reviewed manifest, 24-hour
  object-age fence, live Backup CR plus backup-metadata protection, and
  apply-time drift checks. This makes operator cleanup safer but does not
  replace the lifecycle backstop; lifecycle policy remains blocked on the
  minimum required credential.

### 2026-07-27 — extracted from outage plan

- Separated from the completed incident response because the remaining work is a privileged storage operation.
