---
id: homekit-device-room-renames
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/superseded/homekit-refresh-followups.md
---

# Reconcile HomeKit, Sonos, and Hue names and rooms

Several accessory names and room assignments remain inconsistent after the
great refresh. Sonos and Hue are the source systems for their own names.

## Remaining

- [ ] Use test chimes to identify the bedroom Sonos pair. In Sonos, rename
      `Main Bathroom` to `Master Bathroom`, rename `Play` to `Rooftop`, and give
      the verified bedroom speakers distinct names.
- [ ] Rename the three Hue rooms and `R&B Lamp` in Hue, then confirm Home
      Assistant and Apple Home converge on the canonical names.
- [ ] Choose and apply the desired Apple Home room for the eight presence tiles,
      then verify no duplicate accessories or stale room names remain.
- [ ] Confirm the three native Roborock Matter tiles remain, the three
      Home Assistant-bridged duplicate switches and Litter Box tile are gone,
      then move the native tiles out of Office and normalize their names.

## Comment Log

### 2026-07-27 — split from HomeKit refresh

- Operator-blocked because identification requires audible device tests and
  changes in the owner-controlled Sonos, Hue, and Apple Home apps.
