---
id: homekit-lock-hardening
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/superseded/homekit-refresh-followups.md
---

# Harden front-door lock behavior in Apple Home

Apple Home now offers authentication and notification controls for the exposed
front-door lock. The desired user-facing policy has not been selected.

## Remaining

- [ ] Operator decides whether Apple Home must require authentication to unlock
      and whether lock/unlock notifications are desired.
- [ ] Apply the selected settings and exercise one supervised lock and unlock
      from Apple Home without changing the Home Assistant automation contract.
- [ ] Record the chosen policy and observed notification behavior.

## Comment Log

### 2026-07-27 — split from HomeKit refresh

- Separated the security policy decision from device naming and camera checks.
