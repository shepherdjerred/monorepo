---
id: reference-completed-2026-07-09-ha-registry-cleanup
type: reference
status: complete
board: false
---

# HA Great Refresh — Registry Cleanup, Naming Consistency, HomeKit Finalization

## Goal / bar

Everything should **feel correct and consistent everywhere a name appears**: HA areas, HA device names, entity friendly names, entity_ids, HomeKit accessory names and rooms, and the vendor apps (Sonos, Hue, eWeLink). Acceptance criteria:

- Every physical device has an area; every area uses the canonical room vocabulary
- One naming pattern for devices: `<Room> <Thing>` (e.g. "Master Bedroom Thermostat"), no two devices sharing an ambiguous name
- entity*ids agree with the device + room they belong to (no `entryway*\*` on a Living Room speaker)
- HomeKit tiles show the same names, in the right rooms
- Sonos/Hue/eWeLink app names match HA (vendor app is source of truth where the integration syncs names from it)

## Context

A multi-session audit of Home Assistant found: (a) an approved-but-unshipped HomeKit exposure cleanup sitting on branch `fix/homekit-exclude-front-door` (4 commits, 548→231 exposed entities), and (b) years of registry drift inside HA itself — a renamed area whose stale `area_id` (`guest_bedroom`) now points at the Office, inconsistent room vocabulary ("Main Bathroom" vs "Master Bathroom", "Guest room" vs "Guest Bedroom"), stale entity*ids referencing rooms devices no longer live in (`media_player.entryway`, `unnamed_room*_`, `dining*room_switch*_`), two devices literally named "Sensor", duplicate device names ("Bedroom" ×5), and ~10 physical devices with no area.

User decisions locked in:

- **Full pass** — rename stale entity_ids too, updating Temporal references in the same change
- **Long area names** — Master Bedroom, Master Bathroom, Guest Bedroom, Guest Bathroom
- **Scripted apply** via HA WebSocket API (snapshot → dry-run diff → apply)
- **Expose `lock.front_door`** to HomeKit
- SONOFF numbering is intentional (leave); spare Sonoff goes to the Litter-Robot; torvalds KVM already has ATX power (no plug needed)

Verified blast radius for entity_id renames (all read-only scans done):

- HA has **zero** native automations/scripts (all migrated to Temporal); scenes are Hue-native (no entity_id refs); Lovelace is default auto-generated (72 bytes, no refs)
- Temporal references exactly one renamed entity: `media_player.main_bathroom` (in `packages/temporal/src/workflows/ha/` — good-morning/good-night/welcome-home)
- HomeKit filter globs (`switch.*crossfade*` etc.) still match post-rename names
- Renamed entities re-appear as **new accessories in Apple Home** → user re-assigns rooms afterward (accepted)

## New capability — Apple Home state is locally queryable (read-only)

Discovered this session: homed's datastore on this Mac is readable at `~/Library/HomeKit/core.sqlite` (+`-wal`). Copy the db+wal to scratchpad, then SQL against `ZMKFROOM` / `ZMKFACCESSORY` (join `ZROOM`) gives Apple Home's actual room list and accessory→room→name assignments — no Apple API needed. Already validated: pulled all 13 HomeKit rooms and 72 accessories. (`datastore3.sqlite` is HKSV clip metadata — 1,101 clip records confirm Secure Video is recording.)

This upgrades the plan in three ways:

1. **Naming spec gets a HomeKit column with real data** — current Apple-side names/rooms, not guesses.
2. **Apple-side drift found and folded into the spec**: all 10 Aeotec "Sensor" tiles are dumped in **Office** in Apple Home (physical devices are in Laundry/Storage); the "Hallway" switch tile is in **Master Bedroom** (HA says Entryway — confirm which is physically true); Apple room "Guest Room" needs renaming to "Guest Bedroom"; the ambiguous Zooz names ("Main" ×3, "Stairs" ×2, "Light" ×2) are mirrored into Apple Home, which breaks Siri targeting.
3. **Verification becomes objective**: before/after snapshots of `core.sqlite` prove the stale Reolink/Eufy front-door tiles (confirmed present: Motion/Person/Pet/Vehicle/Visitor/Camera/Debug ×2) disappear post-deploy, and that renamed accessories land in the right rooms — plus an exact tile-by-tile removal checklist for the manual Apple Home pass instead of "look for No Response".

Caveat: the local store lags iCloud sync and the copy is a snapshot; re-copy before each verification pass. It's read-only.

## New capability — Apple Home WRITES via HomeClaw (researched)

Apple ships no public HomeKit API for macOS; the only write path is `HMHomeManager` inside a Catalyst app with the `com.apple.developer.homekit` entitlement. **[HomeClaw](https://github.com/omarshahine/HomeClaw)** is exactly that, packaged: a Mac App Store app ([App Store link](https://apps.apple.com/us/app/homeclaw/id6759682551?mt=12)) exposing `homeclaw-cli` + an MCP server for Claude Code. Relevant commands, all supporting `--dry-run`:

- `homeclaw-cli assign-rooms rooms.json --dry-run` — **bulk** accessory→room assignment from a JSON spec
- `homeclaw-cli rename <old> <new>` / `rename-room` / `create-room` / `remove-room`
- `homeclaw-cli remove-accessory <name>` — delete stale tiles

Requirements met: needs macOS 26+ (this Mac is on 27); App Store build is fully signed so no developer-account build required. **User setup: install from the App Store, launch once, grant HomeKit access** (one prompt). Optionally add its Claude Code plugin/MCP for direct tool access.

This moves the Apple-side drift fixes (Sensor ×10 tiles dumped in Office, Hallway tile in Master Bedroom, "Guest Room" → "Guest Bedroom" room rename, ambiguous tile names) and the post-deploy cleanup (remove stale front-door tiles, bulk-assign ~50 re-appeared accessories to rooms) from your manual queue into **Phase 3, scripted**, driven by the same Phase 0 naming spec, verified against the `core.sqlite` read path. Still manual in the Home app: the first-launch HomeKit permission grant, and lock security/notification toggles (Home-app-only settings).

## Phase 0 — Canonical Naming Spec (review gate)

Before touching anything, produce the **naming spec**: one table covering all 132 devices × (canonical room, HA device name, entity_id prefix, current + target HomeKit tile name/room from the `core.sqlite` pull, vendor-app name + which app owns it). Built from the registry data already pulled; delivered as an artifact for your review. **Nothing applies until you approve this table.** This is what makes it a refresh rather than spot fixes — every later phase just implements the approved spec.

Canonical room vocabulary (locked): Master Bedroom, Master Bathroom, Guest Bedroom, Guest Bathroom, Kitchen, Living Room, Office, Entryway, Laundry, Storage, Rooftop, Front Door.

## Phase 1 — Ship the repo changes (one PR)

Branch `fix/homekit-exclude-front-door` (worktree `.claude/worktrees/homekit-exclude-front-door`) already has 4 commits. Add one more commit, then PR:

1. **Expose the lock** — add `lock.front_door` to HA1's `include_entities` in
   `packages/homelab/src/cdk8s/config/homeassistant/configuration.yaml` (same mechanism as the device_tracker whitelist; `lock` domain stays out of `include_domains`).
2. **Temporal rename prep** — in `packages/temporal/src/workflows/ha/` (grep for `media_player.main_bathroom` across `good-morning.ts`, `good-night.ts`, `welcome-home.ts`), change to `media_player.master_bathroom`. Note in the PR body: this reference goes live when the Phase 3 rename runs; between merge and rename the affected workflow step will no-op/fail on a missing entity — acceptable brief window (bathroom speaker automation only).
3. **Fix the floor-heat shortfall** (root-caused this session): `packages/temporal/src/workflows/ha/good-morning.ts:23` — `goodMorningWakeUp` (8:00am) sets 40°C then hard-off after `MORNING_HEAT_DURATION = "60 minutes"`. Measured ramp is ~8.3°C/hour from a ~22°C start, so it shuts off at ~30.6°C, ~70 minutes short of target. Fix: add a **preheat schedule** in `packages/temporal/src/schedules/register-schedules.ts` firing ~2¼ hours before wake (≈5:45am weekday / adjust for weekend) that sets `climate.master_bathroom` to 40°C, and have `goodMorningWakeUp` keep its existing turn-off (net window ≈5:45–9:00). Update the catch-up-window comment at `register-schedules.ts:353` accordingly. (Alternative — just lengthening the duration — makes the floor peak _after_ the morning routine, so preheat is the right shape.)
4. Verify: `bun run test` + `bun run typecheck` in the worktree (temporal has its own check: `bun run --filter='./packages/temporal' typecheck`).
5. Push, open PR, monitor via `pr-monitor` skill, merge; ArgoCD syncs the ConfigMap; HA needs a restart to reload `configuration.yaml` (note: HA pod restart via `kubectl rollout restart -n home deploy/<homeassistant>` after sync, or restart from HA UI). Temporal worker redeploys via the normal image-bump flow.

## Phase 2 — Registry snapshot + mutation script

New throwaway Bun script in the scratchpad (pattern already proven this session — WS auth + `config/*_registry/list`):

1. **Snapshot**: dump `entity_registry`, `device_registry`, `area_registry` to a timestamped rollback file (keep locally + attach summary to the session log).
2. **Dry-run**: script prints the full old→new diff table; user approves before apply.
3. **Apply** via WS commands: `config/area_registry/create|update|delete`, `config/device_registry/update`, `config/entity_registry/update` (supports `new_entity_id`, `name`, `area_id`).

### 2a. Area surgery (order matters)

| Step | Action                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Create area `Office` (fresh `office` area_id), move all 15 devices + any entity-level overrides off `guest_bedroom`, delete `guest_bedroom` area |
| 2    | Recreate `bathroom` → `master_bathroom` id (name "Master Bathroom"), same move-and-delete procedure                                              |
| 3    | Recreate `bedroom` → `master_bedroom` id (name "Master Bedroom"), same                                                                           |
| 4    | Rename area "Guest room" → "Guest Bedroom" (display rename only; keep its area_id)                                                               |
| 5    | Keep floors intact (`master_bedroom` floor holds both master areas)                                                                              |

### 2b. Device renames

| Device (current)                                   | New name                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| "Sensor" (Aeotec ZWA024 @ Laundry)                 | Laundry Multisensor                                                                                       |
| "Sensor" (Aeotec ZWA024 @ Storage)                 | Storage Multisensor                                                                                       |
| "Main Bathroom" (Sonos One)                        | Master Bathroom                                                                                           |
| "Play" (Sonos @ Rooftop)                           | Rooftop                                                                                                   |
| "Thor"/"Kit" (Whisker Cat)                         | Thor (Litter-Robot) / Kit (Litter-Robot)                                                                  |
| "Thor"/"Kit" (Petlibro Pet)                        | Thor (Feeder) / Kit (Feeder)                                                                              |
| "Bedroom" ×5 → disambiguate                        | Master Bedroom Hue Room / Sonos Era / Sonos One / Thermostat / AC (per manufacturer)                      |
| "Office" ×4, "Living Room" ×3, "Guest Bathroom" ×2 | same pattern: room + device type                                                                          |
| "Guest Bedroom" (Emporia circuit)                  | Office Circuit (it measures the room now named Office) — verify circuit mapping with user before renaming |

Zooz load-named switches ("Main", "Light", "Stairs", "Side", "Hallway", "Pendants", "Cabinets") stay — they're named for the load they control, which is correct.

### 2c. Area assignments (devices currently area-less)

Hue smart buttons 1–4, Guest room Hue dimmer → their rooms (ask user which rooms the buttons live in — one AskUserQuestion batch during execution); Flume bridge + sensor → Storage or utility location (ask); router (RT-AX88U ×2 device entries) → Office or wherever it physically sits (ask). Integration-wrapper devices (HACS, Adaptive Lighting, Sun, pets, phones, Electricity Maps, etc.) intentionally stay area-less.

### 2d. Entity_id renames (enabled entities only)

| Old pattern                                                                                    | New pattern                                                                              | Count |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----- |
| `*.entryway_*` (Sonos "Record Player", lives in Living Room)                                   | `*.record_player_*` (device-named — avoids collision with the Arc's `living_room_*` ids) | 6     |
| `*.unnamed_room_*` (Sonos @ Rooftop)                                                           | `*.rooftop_*`                                                                            | 9     |
| `event.dining_room_switch_button_1-4` + `sensor.entry_switch_*` (all on "Bedroom wall switch") | `*.bedroom_wall_switch_*`                                                                | 6     |
| `*.main_bathroom_*` (Sonos)                                                                    | `*.master_bathroom_*` (verified free — Mysa owns different object_ids)                   | ~10   |
| `sensor.sensor_*` / `binary_sensor.sensor_*` / etc. (two Aeotec multisensors)                  | `*.laundry_multisensor_*` and `*.storage_multisensor_*`                                  | ~20   |
| `sensor.flume_sensor_meta_house_current_day_cost`                                              | friendly name only → "Water Cost Today" (entity_id fine)                                 | 1     |
| `device_tracker.shuxin_2` (empty name)                                                         | friendly name → "Shuxin's iPhone"                                                        | 1     |

Skip: disabled entities, `switch.hallway` family (load-named, correct), asuswrt junk trackers (already HomeKit-excluded; disabling them is a stretch goal, ask user at the end).

### 2e. Registry oddity cleanup

- Delete the dead duplicate `binary_sensor.granary_smart_camera_feeder_today_s_feeding_schedule_2` registry entry (same device as `_1`; verify which one is live first via states — delete the orphan).

## Phase 3 — Execute + verify (HA side, then Apple side)

1. Run the script's apply step (after dry-run approval).
2. Restart HA (picks up `configuration.yaml` from Phase 1 too, exposing `lock.front_door` and re-advertising renamed entities).
3. Re-pull all registries via WS; diff against intended state; confirm zero drift.
4. Re-run the HomeKit filter simulation against fresh states — expect 231 + 1 lock = **232 exposed**; confirm renamed entities still land in the right include/exclude buckets.
5. Confirm Temporal workflows healthy (the ha workflows run on schedules; check `media_player.master_bathroom` resolves — or trigger the relevant workflow manually via Temporal UI/CLI).
6. **Apple-side cleanup via `homeclaw-cli`** (after user installs HomeClaw + grants access; every step dry-run first):
   a. `rename-room "Guest Room" "Guest Bedroom"` (and any other room-name drift vs canonical).
   b. `remove-accessory` for the stale tiles: the 7 front-door Reolink/Eufy sensors + camera duplicate, plus each pre-rename accessory that went No Response.
   c. Generate `rooms.json` from the Phase 0 naming spec; `assign-rooms rooms.json --dry-run` → review → apply. Covers the ~50 re-appeared renamed accessories AND the existing drift (Sensor tiles → Laundry/Storage equivalents, Hallway tile → its physically-correct room).
   d. `rename` any tiles whose Apple-side names diverge from the spec (previously hand-renamed tiles keep custom names otherwise).
7. Re-copy `~/Library/HomeKit/core.sqlite` and diff accessory→room→name against the spec — the objective Apple-side acceptance check.

## Phase 4 — Docs + follow-ups

1. Mirror this plan to `packages/docs/plans/2026-07-09_ha-registry-cleanup.md` (commit with the PR or after).
2. Update the session log `packages/docs/logs/2026-07-09_homekit-exposure-audit.md` with a new Session Log block.
3. Create `packages/docs/todos/litter-robot-sonoff.md` (status: `active`): install spare Sonoff on Litter-Robot, name it per convention, then optional automation: `sensor.litter_robot_4_status_code` fault → power-cycle (needs user's plug install first).
4. Create `packages/docs/todos/ha-integration-reauth.md` (status: `blocked`, user-only): re-auth `econet` + `smartthings` in HA UI; after econet re-auth, check whether the `Heat Pump Water Heater_*` doubled names self-heal — if not, fix friendly names in a quick follow-up.

## Your manual runbook (other apps, physical — can't be scripted)

### Anytime (independent of my phases)

1. **HA UI — re-auth EcoNet** (fixes the dead water heater, 11 entities):
   Settings → Devices & Services → the EcoNet card will show a "Reconfigure"/"Attention required" banner → re-enter the Rheem account creds (`rheem@sjer.red`). If the password isn't in 1Password, recover via Rheem's app first.
2. **HA UI — re-auth SmartThings** (fixes the dead Samsung TV media_player):
   Same screen → SmartThings card → reconfigure. Note: SmartThings migrated to a new OAuth flow in 2025 — HA will walk you through a Samsung login in the browser. If it fights you, deleting the integration and re-adding is cleaner than fighting a stale token.
3. **Physical checks at the house** (or ask whoever's there):
   - Q7 Max vacuum is offline — check it's on the dock and the dock has power; a dock power-cycle usually brings Roborocks back.
   - "Living Room Console" Sonoff plug (`sonoff_1002165aef`) is unreachable — check it's still plugged in and on WiFi; power-cycle it at the outlet.

### Before/with Phase 2 (I'll ask inline, but you can prep answers)

4. **Room locations for the area-less hardware** — where do these physically live?
   Hue smart buttons 1–4, the "Guest room" Hue dimmer, Flume bridge + Flume sensor, the router.
5. **Confirm the Emporia "Guest Bedroom" circuit** actually feeds the room now called Office (the former guest bedroom) before I rename it to "Office Circuit".

### With Phase 2 (vendor apps — rename at the source of truth, per the approved naming spec)

6. **Sonos app — rename rooms** (HA's Sonos integration derives device names from Sonos room names; renaming only in HA leaves the Sonos app stale):
   - "Main Bathroom" → "Master Bathroom"
   - "Play" → "Rooftop"
   - If the two Master Bedroom speakers are both just "Bedroom" in the Sonos app, give them distinct names there too (e.g. "Master Bedroom" + "Master Bedroom Nightstand").
     Sonos app → Settings → System → \<room\> → Room Name.
7. **Hue app — align room/zone names** to the canonical vocabulary (the Hue integration surfaces Hue "Room" groups as HA devices — e.g. the device currently named just "Bedroom"). Hue app → Settings → Rooms & zones. Also rename any lights whose Hue-app names drift from the spec (e.g. "Hue color lamp 1" → its real name, "CB2 Lamp").
8. **eWeLink app — name the numbered plugs' three active siblings** consistently if desired ("Desktop PC", "NAS", "Living Room Console" already match the spec — just confirm), and name the new Litter-Robot plug there when installed.

### Before Phase 3 Apple-side step (one-time, ~2 minutes)

9. **Install [HomeClaw](https://apps.apple.com/us/app/homeclaw/id6759682551?mt=12) from the Mac App Store**, launch it, and grant HomeKit access when prompted. Everything else Apple-side (room renames, stale-tile removal, bulk room assignment, tile renames) is now scripted in Phase 3 step 6 with dry-runs — no Home-app clicking marathon.

### After Phase 3 (Apple Home app — the small remainder HomeClaw can't do)

10. **Front Door lock security settings**: Accessory Settings → enable "Require authentication to unlock" if desired, plus lock/unlock notifications. (Room assignment/naming already scripted.)
11. **Sanity pass**: spot-check a few rooms in the Home app + ask Siri for a canonical room ("turn off the Guest Bedroom lights") to confirm voice targeting works.

### Hardware (whenever the spare Sonoff is handy)

14. **Litter-Robot plug**: plug the spare S31 into the Litter-Robot's outlet, pair it in the **eWeLink app** (it'll join like your numbered ones), name it "Litter-Robot" there. HA discovers it via the Sonoff LAN integration automatically. Tell me when it's in — I'll wire the optional fault-code → power-cycle automation (tracked in the todo doc).

### Floor heat (after Phase 1 deploys)

15. **Verify the preheat fix the next morning**: floor should reach ~40°C by 8:00am. If the ramp is slower on cold days, we tune the preheat lead time (it's one constant).

## Verification summary

- Repo: `bun run test`, `bun run typecheck`, pre-commit suite (already proven green on this branch)
- Live: post-apply registry re-pull diff == intended; HomeKit filter simulation == 232; Temporal `media_player.master_bathroom` resolves; Apple Home shows lock + no stale front-door sensors
- Refresh acceptance: re-run the full inventory pull and check it against the approved Phase 0 naming spec — zero devices without areas, zero non-canonical room strings, zero ambiguous duplicate device names, entity_id prefixes match their device/room
- Apple Home side: re-copy `~/Library/HomeKit/core.sqlite` and diff accessory→room→name against the spec — stale front-door tiles gone, renamed accessories present in correct rooms, no accessory left in a non-canonical room
- Floor heat: next-morning history pull shows floor ≥ ~38°C by 8:00am
- Rollback: snapshot file from Phase 2 step 1 + script's inverse-apply mode (write it alongside the apply mode)
