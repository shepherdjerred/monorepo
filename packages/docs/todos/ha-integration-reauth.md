---
id: ha-integration-reauth
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/2026-07-09_ha-registry-cleanup.md
source_marker: false
---

# Restore Econet after the Home Assistant 2026.8 fix deploys

## Investigation

- **smartthings**: RESOLVED — user re-authed, entry `loaded`.
- **econet**: Rheem's endpoint now passes TLS and returns HTTP 200. Upstream
  issue home-assistant/core#172228 is closed and fix PR #176736 is merged for
  Home Assistant 2026.8. The live and repository pin is still 2026.7.4, so the
  remaining prerequisite is deploying 2026.8 or newer, not waiting on Rheem's
  certificate chain.
- **roborock**: vacuum is online; the integration failed to _import_ — cffi
  python-package vs compiled-backend version skew caused by a mid-startup pip
  upgrade race (the `install-eufy-security` init container). Site-packages are
  consistent now; a plain HA restart fixes it. Reload alone cannot (the stale
  compiled module is cached in the running process).

## Remaining

- [ ] Deploy Home Assistant 2026.8 or newer, which includes upstream fix PR #176736.
- [ ] Have an operator reload Econet and verify the water-heater entities update without a local distrusted-root workaround.
- [ ] If econet recovers, reconcile any duplicated `Heat Pump Water Heater_*` friendly names.

## Comment Log

- 2026-07-27 — Board audit confirmed SmartThings and Roborock are resolved. The
  only remaining problem is Rheem's upstream certificate chain, not reauth.
  Classified blocked and operator-verified because recovery requires live Home
  Assistant access after an external fix.

- 2026-08-02 — Rheem TLS now succeeds, upstream issue #172228 is closed, and fix PR #176736 is merged for Home Assistant 2026.8. Updated the blocker from external certificate repair to the pending Home Assistant version rollout.
