---
id: homekit-refresh-followups
status: active
origin: packages/docs/plans/2026-07-09_ha-registry-cleanup.md
source_marker: false
---

# HomeKit great-refresh follow-ups (2026-07-09)

The refresh itself shipped and verified (71 accessories / 12 canonical rooms /
zero unreachable — see the plan and `packages/docs/logs/2026-07-09_homekit-exposure-audit.md`).
These are the deliberate leftovers.

## User / at-the-house

- [ ] **Verify HKSV after the camera re-pair**: the front-door camera was
      accidentally unpaired during cleanup (removed as a presumed orphan) and
      re-paired the same evening. Confirm Stream & **Allow Recording** is
      re-enabled (Record: Any Motion, Notify: person) and clips appear —
      recording history from before the re-pair is likely gone.
- [ ] **Front-door lock hardening** (new in Apple Home): enable "Require
      authentication to unlock" + lock/unlock notifications if wanted.
- [ ] **Sonos app renames** (Sonos is the naming source of truth; HA re-derives):
      "Main Bathroom" → "Master Bathroom", "Play" → "Rooftop".
- [ ] **Bedroom Sonos identification**: user recalls 2× One in the bedroom;
      registry says Era 100 + One (and 2× Era 100 as living-room surrounds).
      Settle with a per-speaker test chime, then name the pair distinctly.
- [ ] **Hue app renames**: rooms "Bedroom"→"Master Bedroom",
      "Living room"→"Living Room", "Guest room"→"Guest Bedroom"; the bedroom
      bulb device named "R&B Lamp" → "Bedroom Right Lamp".
- [ ] **Presence tiles' room**: the 8 device-tracker occupancy tiles landed in
      Office (HomeKit default room). Fine functionally; move via hkctl
      `assignRooms` if a different room reads better.
- [ ] **Litter-Robot Sonoff install** — tracked separately in
      `litter-robot-sonoff.md`.

## Verification / watching

- [ ] **Floor preheat first live run** (morning after 2026-07-09 deploy):
      `climate.master_bathroom` floor should reach ~40°C by 8:00 AM
      (preheat schedules fire 5:45 weekdays / 6:45 weekends). Pull the history
      and tune the 2h15m lead if short.
- [ ] **Kumo humidity sensors** (`sensor.bedroom_current_humidity`,
      `sensor.living_room_current_humidity`) stuck `unknown` since the
      2026-07-09 17:38 HA restart, survived the 2026.7.1 upgrade restart.
      If still `unknown` after a few days, dig into the kumo integration.
- [ ] **econet / water heater** — blocked on Rheem's cert chain, tracked in
      `ha-integration-reauth.md` (upstream home-assistant/core#172228).

## Code / tooling

- [ ] **hkctl rebuild**: source now lives in `sandbox/poc/hkctl` (the session
      build was lost with the scratchpad). Rebuild per its README when next
      needed; consider promoting out of sandbox if it keeps earning its keep.
- [ ] **Unexplained HA restart at 2026-07-09 17:38 PT** — predates all session
      changes and took down econet/roborock/one Z-Wave node. Never attributed;
      check deploy/ArgoCD/node history if it recurs.
