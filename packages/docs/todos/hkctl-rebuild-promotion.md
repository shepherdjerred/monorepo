---
id: hkctl-rebuild-promotion
type: todo
status: planned
board: true
verification: agent
disposition: deferred
origin: packages/docs/archive/superseded/homekit-refresh-followups.md
---

# Rebuild and decide the home for hkctl

The HomeKit maintenance source lives in `sandbox/poc/hkctl`; the one-off binary
from the refresh session was not retained. No current operation requires it.

## Remaining

- [ ] Before the next HomeKit bulk-maintenance session, build `hkctl` from its
      README in a clean checkout and exercise a read-only inventory command.
- [ ] If the tool is needed again after that session, move it from sandbox into
      a maintained package with tests and documented credential handling;
      otherwise leave it as an explicit proof of concept.

## Comment Log

### 2026-07-27 — split from HomeKit refresh

- Deferred until another operation establishes recurring value; rebuilding an
  unused local binary is not active product work.
