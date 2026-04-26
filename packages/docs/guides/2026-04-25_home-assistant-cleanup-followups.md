# Home Assistant Cleanup — Next Steps

Related: `guides/2026-04-25_homelab-health-audit.md`. Follows from log audit + cleanup session on 2026-04-25.

## Already done

- Purged 12 orphan entities from Mysa thermostat removal (incl. `climate.bedroom`, `climate.office` with empty `hvac_modes` that triggered `pyhap TargetHeatingCoolingState=0 invalid` at every boot)
- Reloaded Roomba integration (now reporting valid state)
- Confirmed Opower fully removed (0 active repair issues)
- Rolled Prometheus → HA bearer token (token now in `prometheus-secrets:HOMEASSISTANT_TOKEN`, hot-reloaded via file mount)
- Confirmed Roomba network fix (zero `roombapy` errors in 48h)

## Open — needs user action

### 1. Hue cleanup (your hands)

Two lamps are physically gone but still registered:

- `light.bludot_stilt_lamp` (BluDot Stilt Lamp)
- `light.signe_lamp` (Hue Signe floor)

Delete them from Hue app, then **Settings → Devices & Services → Hue → Reload**. The 3 rooms (Bedroom/Living/Office) are NOT empty and don't need touching — `state=unknown` on scenes is the default for un-triggered scenes, not a brokenness signal.

### 2. Bedroom Sonos Era 100 — bad Wi-Fi

IP `192.168.1.172`, MAC `80:4a:f2:93:d4:ec`, firmware **18.2** (one minor behind — Bedroom One and Living Room Arc are on 18.3).

60s ping vs healthy speakers:

| Speaker                | Min    | Avg    | Max        |
| ---------------------- | ------ | ------ | ---------- |
| **Bedroom Era 100**    | 2.5 ms | 26 ms  | **924 ms** |
| Bedroom One (.40)      | 1.0 ms | 3.5 ms | 54 ms      |
| Living Room Arc (.240) | 1.2 ms | 8.9 ms | 145 ms     |

0% loss + 924ms peaks = Wi-Fi link-layer retransmits or aggressive radio power-save. Bedroom One is fine in the same room → not the AP coverage area, specifically this Era 100.

**Fix order:**

1. Force firmware update 18.2 → 18.3 in Sonos app. May be stuck.
2. If still bad: pin to 5 GHz on a single AP (disable band-steering for this MAC).
3. Last resort: Sonos Combo Adapter for wired Ethernet (Era 100 has no native Ethernet port).

This produces ~10 "cannot reach Bedroom" warnings/day in HA logs (69 over last 7 days).

### 3. Litter-Robot reload

`litterrobot` config entry `01JYZA00YS8Z617N72D15REXYM` is in `setup_error` from today's HA boot. Whisker is healthy (verified against Whisker's prod uptime monitor — 100% across all services). Bootstrap timeout was HA executor starvation, not a Whisker outage.

Reload via UI or:

```bash
HA_TOKEN=$(kubectl -n prometheus get secret prometheus-secrets -o jsonpath='{.data.HOMEASSISTANT_TOKEN}' | base64 -d)
kubectl -n home exec deployment/home-homeassistant -c main -- sh -c \
  "curl -s -X POST -H 'Authorization: Bearer $HA_TOKEN' -H 'Content-Type: application/json' \
    http://localhost:8123/api/services/homeassistant/reload_config_entry \
    -d '{\"entry_id\":\"01JYZA00YS8Z617N72D15REXYM\"}'"
```

## Open — worth investigating

### 4. Sonoff outage (13 unavailable entities)

Two Sonoff devices fully offline:

- `1002165aef` — current/voltage/energy/power/RSSI sensors + LED switch + startup select
- `100216607a` — same shape
- Plus `switch.office_left_blinds`

Either physically unplugged, off Wi-Fi, or eWeLink cloud auth broke. Check `Settings → Devices & Services → Sonoff` for reauth banner.

### 5. HA Backup integration broken (5 unavailable entities)

All five backup state entities are `unavailable`:

- `event.backup_automatic_backup`
- `sensor.backup_backup_manager_state`
- `sensor.backup_last_attempted_automatic_backup`
- `sensor.backup_last_successful_automatic_backup`
- `sensor.backup_next_scheduled_automatic_backup`

HA's built-in backup should never go unavailable. Likely a config/storage issue. Investigate via `Settings → System → Backups`.

### 6. Kumo Living Room AC offline

- `climate.living_room` and `sensor.living_room_current_temperature` unavailable
- Kumo HVAC unit may be power-cycled or off the network. Quick ping to confirm.

### 7. Old iPad #2 — 8 unavailable mobile_app entities

If that iPad is decommissioned, delete the device from `Settings → Devices & Services → Mobile App` to clear the 8 entities (`sensor.ipad_2_*`).

## Open — chronic / accept

### 8. PetLibro custom integration — chronic upstream cloud flake

3 metadata sensors (`granary_smart_camera_feeder_*`) frequently unavailable. Top non-roomba error source over last 30 days (806 errors / 9 days, "Cannot connect to host api.us.petlibro.com"). Options:

- Lower polling frequency in the custom integration config
- Filter `Cannot connect to host` to debug-level via Python logging
- Replace with a less aggressive fork
- Accept it (current state)

### 9. pylitterbot upstream issue — boot-time SRP timeout

When HA boots, `pylitterbot.session.login` runs synchronous Cognito SRP via `loop.run_in_executor(None, ...)` — shared executor with all other integrations. Under bootstrap concurrency, the call queues past HA's 145s stage-2 budget and gets cancelled. Reproduces on most HA restarts (33 cancelled-setup events in 30 days).

Worth filing on `natekspencer/pylitterbot`. Suggested fixes:

- Use a dedicated thread executor for SRP login (not the shared default)
- Fail fast and raise `ConfigEntryNotReady` so HA's normal `setup_retry` handles it instead of blocking the whole stage-2 budget

### 10. HACS pending updates (12 components, 26 repair items)

Cosmetic — clear themselves on next HA pod restart after applying updates.

## Reference data

- HA pod: `home-homeassistant-*` in `home` namespace, container `main`, cluster `torvalds`
- HA version at audit time: `2026.4.3`
- Bearer token (Prometheus reuses): `kubectl -n prometheus get secret prometheus-secrets -o jsonpath='{.data.HOMEASSISTANT_TOKEN}' | base64 -d`
- Recorder DB: `/config/home-assistant_v2.db` (read-only via `sqlite3 file:...?mode=ro`)
- Loki query for HA logs: `{namespace="home", pod=~"home-homeassistant-.*"}` — 30+ days retention
- Whisker uptime monitor (production): all services 100%, 30–50ms response
