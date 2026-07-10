---
id: ha-integration-reauth
status: blocked
origin: packages/docs/plans/2026-07-09_ha-registry-cleanup.md
source_marker: false
---

# Broken HA integrations: econet (upstream cert), roborock (needs restart)

## Status 2026-07-09 (investigated — original "re-auth" framing was wrong)

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

## Remaining steps

1. Restart HA → roborock loads, Q7 Max returns to HomeKit.
2. Watch home-assistant/core#172228 / Rheem for the econet chain fix; re-check the
   water heater after any Rheem-side change.
3. After econet recovers: check whether the doubled `Heat Pump Water Heater_*`
   friendly names self-heal; fix if not.
