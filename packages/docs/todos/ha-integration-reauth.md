---
id: ha-integration-reauth
status: blocked
origin: packages/docs/plans/2026-07-09_ha-registry-cleanup.md
source_marker: false
---

# Re-auth broken HA integrations (econet, smartthings)

## Why

Both are in `setup_error` (found in the 2026-07-09 full-inventory audit):

- **econet** (Rheem, `rheem@sjer.red`) — the Heat Pump Water Heater and all 11 of
  its entities have been `unavailable` because of this.
- **smartthings** ("Home") — `media_player.living_room_television` and its two
  TV-channel sensors are dead.

## Steps (user-only — needs account credentials in the HA UI)

1. HA UI → Settings → Devices & Services → EcoNet card → reconfigure/re-auth with
   the Rheem account creds. If the password isn't in 1Password, recover it via
   Rheem's app first, then store it in the Homelab vault.
2. Same screen → SmartThings card → reconfigure (new Samsung OAuth flow; if it
   fights, delete + re-add the integration).
3. After econet re-auth: check whether the doubled friendly names
   (`Heat Pump Water Heater_alert_count` style) self-heal. If not, fix the
   friendly names in a follow-up pass.
4. Verify `water_heater.heat_pump_water_heater` and the Samsung TV media_player
   report real states again.

## Blocked on

User running the re-auth flows (account credentials + interactive OAuth).
