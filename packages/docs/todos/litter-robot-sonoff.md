---
id: litter-robot-sonoff
status: active
origin: packages/docs/plans/2026-07-09_ha-registry-cleanup.md
source_marker: false
---

# Litter-Robot Sonoff plug + fault auto-recovery

## Why

The Litter-Robot 4 gets into error states that only a power cycle clears, and the
owner is frequently remote (Atlanta vs the Seattle house). A Sonoff S31 on its
outlet enables remote recovery, and `sensor.litter_robot_4_status_code` already
exposes fault states to automate against.

## Steps

1. **(user, physical)** Plug the spare Sonoff S31 into the Litter-Robot's outlet,
   pair it in the eWeLink app (same flow as the numbered plugs), name it
   "Litter-Robot". HA discovers it via the Sonoff LAN integration.
2. Verify the new `switch.*` entity appears in HA and lands in the Laundry area
   with a canonical name.
3. Optional automation (Temporal, `packages/temporal/src/workflows/ha/`):
   when `sensor.litter_robot_4_status_code` reports a fault state for >N minutes,
   power-cycle the plug (off → 10s → on), with a notification and a
   once-per-day guard. Model on the reconcile-lock reconciler pattern.

## Blocked on

Step 1 — the physical install.
