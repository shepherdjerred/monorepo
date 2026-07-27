---
id: home-assistant-kumo-humidity-recovery
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/homekit-refresh-followups.md
---

# Recover Kumo humidity sensors in Home Assistant

The bedroom and living-room Kumo humidity entities remained `unknown` after the
July 9 Home Assistant restart and subsequent upgrade restart.

## Remaining

- [ ] Check current entity state, attributes, config-entry diagnostics, and Kumo
      integration logs for both humidity sensors.
- [ ] If still unknown, identify whether the upstream device/API omits humidity
      or the integration stopped updating it; fix or retire the entities based
      on that evidence rather than adding a fallback value.
- [ ] Verify both entities report fresh numeric humidity across a restart, or
      document and remove unsupported entities from dependent dashboards.

## Comment Log

### 2026-07-27 — split from HomeKit refresh

- Separated this Home Assistant integration defect from Apple Home operations.
