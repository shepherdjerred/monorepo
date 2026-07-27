---
id: litter-robot-sonoff
type: todo
status: planned
board: true
verification: agent
disposition: blocked
origin: packages/docs/archive/completed/2026-07-09_ha-registry-cleanup.md
source_marker: false
---

# Litter-Robot Sonoff plug + fault auto-recovery

## Why

The Litter-Robot 4 gets into error states that only a power cycle clears, and the
owner is frequently remote (Atlanta vs the Seattle house). A Sonoff S31 on its
outlet enables remote recovery, and `sensor.litter_robot_4_status_code` already
exposes fault states to automate against.

## Remaining

- [ ] After operator approval, document the supported fault states and bounded
      recovery policy.
- [ ] Implement the fault-duration trigger, notification, ten-second cycle, and
      once-per-day guard with workflow tests.
- [ ] Run Home Assistant validation and affected repository verification.

## Blocked on

Physical installation and automation approval are tracked in
`litter-robot-sonoff-installation`.

## Comment Log

### 2026-07-27 — in-progress board audit

- Reclassified as planned and operator-blocked because the first action is a
  physical mains-power installation at the house.
