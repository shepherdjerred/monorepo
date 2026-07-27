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

# Econet integration blocked by Rheem certificate chain

## Investigation

- **smartthings**: RESOLVED — user re-authed, entry `loaded`.
- **econet**: NOT an auth problem. `rheem.clearblade.com` chains to the legacy
  DigiCert Global Root CA, which Mozilla/certifi distrusted 2026-04-15; the HA
  container's certifi 2026.06.17 no longer contains that root, so TLS verification
  fails. Known upstream: home-assistant/core#172228. Blocked on Rheem re-issuing
  their chain. (Possible local workaround if it drags: append the legacy root to
  the pod's certifi bundle via an init step — trusts a distrusted root, use only
  if the water heater absence actually hurts.)
- **roborock**: vacuum is online; the integration failed to _import_ — cffi
  python-package vs compiled-backend version skew caused by a mid-startup pip
  upgrade race (the `install-eufy-security` init container). Site-packages are
  consistent now; a plain HA restart fixes it. Reload alone cannot (the stale
  compiled module is cached in the running process).

## Remaining

- [ ] Wait for Rheem to serve a certificate chain trusted by current Home Assistant/certifi, tracked by home-assistant/core#172228.
- [ ] After an upstream change, have an operator reload econet and verify the water-heater entities update without a local distrusted-root workaround.
- [ ] If econet recovers, reconcile any duplicated `Heat Pump Water Heater_*` friendly names.

## Comment Log

- 2026-07-27 — Board audit confirmed SmartThings and Roborock are resolved. The
  only remaining problem is Rheem's upstream certificate chain, not reauth.
  Classified blocked and operator-verified because recovery requires live Home
  Assistant access after an external fix.
