---
id: log-2026-07-09-homekit-exposure-audit
type: log
status: complete
board: false
---

# HomeKit Exposure Audit

## Context

User noticed the old HA "Front Door" HomeKit accessory still seemed to be
interfering with the doorbell after pairing Scrypted's HomeKit Secure Video
camera directly. Investigation, then a broader ask: audit everything HA
exposes to HomeKit and only keep what makes sense.

## Findings

- PR #1321 (2026-06-26) removed the dedicated `Front Door` HomeKit accessory
  (port `21065`) but `binary_sensor.front_door_person` / `binary_sensor.front_door_visitor`
  were still swept in by HA1's broad `include_domains: [..., binary_sensor, ...]`
  with no matching exclude — so they kept showing up as duplicate standalone
  sensor tiles in Apple Home alongside the new Scrypted-paired camera.
- No CLI/API exists to read Apple's HomeKit pairing database directly. Instead,
  pulled the live entity registry from HA's REST API (`/api/states`, 845
  entities, via Tailscale + the `HA token` 1Password item) and replayed it
  through the actual `homekit:` filter logic in
  `packages/homelab/src/cdk8s/config/homeassistant/configuration.yaml` to see
  exactly what reaches HomeKit.
- Before this session: 548 of 845 entities were exposed (HA1 broad-domain
  bridge + HA2 lights-only bridge). A full audit found ~300 of those were
  noise: companion-app phone/tablet diagnostics (SSID/BSSID/storage/app
  version/steps/etc.), router and Zigbee/Z-Wave mesh health sensors, printer
  consumables, retired front-door camera config, Sonos/media config toggles,
  Hue app's own automation switches, pet static profile fields and feeder
  device metadata, per-circuit energy breakdown, and Roomba historical
  mission stats.
- `device_tracker` domain was also pulling in non-person network devices (NAS,
  printer, TVs, Sonos speakers, game consoles, Mysa thermostats) via
  router/nmap-based tracking — HomeKit presence only makes sense for people,
  so switched that domain from a blanket include to an explicit
  `include_entities` whitelist of the household's phones/tablets.

## Changes

`packages/homelab/src/cdk8s/config/homeassistant/configuration.yaml`:

1. Added `binary_sensor.front_door_*` to HA1's `exclude_entity_globs` (kills
   the leftover person/visitor/motion/connected/debug sensors).
2. Removed `device_tracker` from HA1's `include_domains`; added
   `include_entities` listing the 8 real phone/iPad trackers.
3. Added ~15 new `exclude_entity_globs` patterns and ~40 `exclude_entities`
   covering the noise categories above.

Result: HA1/HA2 combined exposure goes from 548 → 236 entities.

## Verification

- Simulated the old and new filter logic in Python against the live 845-entity
  pull to confirm exact before/after counts and spot-check that nothing
  load-bearing (climate, locks-that-exist-as-locks, lights, water heater
  health, Flume leak detection, Litter-Robot/vacuum status, real presence)
  got swept up by the new globs.
- `bun run test` (homelab, 251/256 pass, 5 pre-existing skips), `bun run
typecheck` (root), and the full pre-commit suite (helm lint, 1Password lint,
  todos, suppressions) all passed on both commits.
- Delivered an interactive artifact (searchable/sortable table of all 845
  entities with exposed/excluded status and reason) so the user could review
  the audit categories before approving scope.

## Open item

`lock.front_door` (the physical door lock, distinct from the retired camera
accessory) has never been in either bridge's `include_domains` — flagged to
the user but left untouched pending a deliberate decision.

## Session Log — 2026-07-09

### Done

- Diagnosed and fixed the leftover `binary_sensor.front_door_*` HomeKit
  exposure (commit `3905674d3` on `fix/homekit-exclude-front-door`).
- Built a live HA-entity-vs-HomeKit-filter classifier and delivered it as an
  interactive artifact.
- Ran a full exposure audit (845 entities), got user sign-off on three
  borderline buckets (non-human device trackers, per-circuit energy, Roomba
  mission stats) via `AskUserQuestion`, then implemented all of them (commit
  `95af381cb`).
- Verified with `bun run test`, `bun run typecheck`, and full pre-commit on
  both commits.

### Remaining

- Open the PR for branch `fix/homekit-exclude-front-door`.
- Decide whether `lock.front_door` should be added to HA1's `include_domains`.
- Deploy and re-run the live entity pull post-ArgoCD-sync to confirm Apple
  Home actually reflects the new counts (HA's `homekit` integration needs a
  restart or bridge re-add for filter changes to take effect on already-paired
  bridges — worth watching for stale tiles the same way the front-door
  accessory was stale after #1321).

### Caveats

- The artifact and this audit are a point-in-time snapshot (2026-07-09) of the
  live entity registry; entities added/renamed later won't retroactively
  match the new globs unless they follow the same naming patterns.
- Excluding an entity from `configuration.yaml`'s `homekit:` filter stops
  advertising it, but any already-paired individual accessory in Apple Home
  may need manual removal if HomeKit cached it before the restart (same
  caveat as the original Front Door accessory going stale after #1321).

## Session Log — 2026-07-09 (evening: great refresh execution)

### Done

- **HA registry refresh applied live** (all 17 verification checks pass): area surgery
  (`guest_bedroom`→`office`, `bathroom`→`master_bathroom`, `bedroom`→`master_bedroom`,
  "Guest room"→"Guest Bedroom"), 15 device renames/moves, 60 entity_id renames,
  2 friendly-name fixes. Rollback snapshot saved in session scratchpad.
- **PR #1432** (HomeKit filter audit + `lock.front_door` + floor preheat): pushed with
  Greptile review fixes (presence-checked 15m preheat chunks, benign-skip alert rule,
  240m timeout) and the stale `light.living_room_main`→`light.living_room` exclusion fix.
  Blocked on a `helm-types` Dagger engine cache error (user declined engine prune).
- **Built `hkctl`** — a minimal Mac Catalyst app (session scratchpad `hkctl/`) signed with
  the user's dev team + HomeKit entitlement; reads and mutates Apple Home directly via
  `HMHomeManager` (list / rename-room / rename-accessory / assign-room / remove-accessory /
  remove-room, JSON command file, dry-run). Replaces the HomeClaw dependency. Gotchas
  learned: TCC attributes raw-binary launches to the terminal (launch via `open`), and the
  new SDK traps apps without scene-lifecycle adoption.
- **Apple Home fixed to the extent possible pre-deploy**: room "Guest Room"→"Guest Bedroom";
  19 tile renames (thermostats/ACs incl. the "Living Room"×2 Siri collision); R&B Lamp
  group area corrected in HA; rogue UI-created "Front Door:21065" HomeKit bridge entry
  deleted from HA; HA1/HA2 bridges reloaded, replacing the 10 dead "Sensor" tiles with
  live "Laundry/Storage Multisensor" tiles, then assigned to their real rooms.
  Final sweep: 12 canonical rooms, 69 accessories, zero name collisions, zero unreachable,
  zero stale vocabulary.
- **Remote fix**: revived the dead Rooftop Z-Wave switch (`switch.main_3`) via ping button.
- An adversarial second audit (subagent) refuted the first audit's "all clean" verdict and
  drove most of the above; its data is preserved in the session scratchpad `audit2/`.

### Remaining

- PR #1432 merge (blocked on `helm-types` — Dagger engine cache corruption; user has
  declined the cache prune twice, so awaiting their direction).
- After merge + ArgoCD sync + HA restart: wave-2 Apple cleanup via hkctl — remove the
  8 stale front-door tiles, verify `lock.front_door` appears + assign to Front Door room.
- User-only: EcoNet + SmartThings re-auth (todos filed), Q7 Max dock power-cycle,
  Living Room Console plug check, Sonos/Hue app renames, Litter-Robot Sonoff install.
- Pending identification: bedroom Sonos pair naming (user's recollection conflicts with
  registry models); Kumo humidity sensors stuck `unknown` since the 5:38pm HA restart.
- Decide where `hkctl` should live permanently (currently session scratchpad only).

### Caveats

- The HomeKit bridges silently skip `entity_category` diagnostic/config entities — the
  845→231 exposure simulation overcounts vs the ~66 actually-bridged accessories, and the
  deployed `device_tracker` domain include was always a no-op for this reason. The pending
  PR's `include_entities` bypasses the skip.
- `lock.front_door` carries `entity_category: diagnostic` from the eufy integration;
  registry override was rejected — cosmetic, but worth an upstream look.
- Something restarted HA at 5:38pm PT (before the registry surgery); econet/roborock/
  Z-Wave-node breakage dates from that restart, not from the refresh.

## Session Log — 2026-07-09 (final: deploy, CI incident, wave 2, camera incident)

### Done

- PR #1432 merged and deployed (chart 2.0.0-5192, HA upgraded to 2026.7.1 in the
  same sync); HA restarted; new HomeKit filter live.
- Wave-2 Apple cleanup via hkctl: 8 stale front-door sensor tiles dropped by the
  bridge; `lock.front_door` exposed and assigned to the Front Door room; the 8
  device-tracker presence tiles arrived with proper names.
- Main-branch CI outage root-caused and fixed: transient ChartMuseum push
  timeout failed the ci-base bump build, parking the last-successful pointer so
  every later main build inherited the VERSION diff and an always-fail guard.
  Unblocked by retrying the push + rebuilding; prevention shipped in PR #1435
  (guard scoped to PR builds, chart pushes retried) — merged.
- Post-restart integration recovery verified: roborock loads (Q7 Max `docked`
  — the "offline vacuum" was a cffi import race the whole time), SmartThings
  re-auth confirmed; econet remains blocked upstream (Rheem cert chain,
  home-assistant/core#172228). Bath Emporia circuit confirmed Guest Bathroom by
  correlating today's 8–9 AM floor-heat window (Floor Heat circuit drew ~590 W;
  Bath drew 0 W).
- **Incident:** removed Apple accessory "Reolink Camera 5BD4" believing it was
  an orphan of the deleted 21065 bridge — it was the live Scrypted HKSV
  pairing (`reachable=true` should have been a hard stop). User re-paired
  on-LAN the same evening; camera verified back in Front Door. Pre-re-pair
  HKSV history likely lost. Lesson recorded in agent memory
  (destructive-ops-verify-provenance).
- hkctl source committed to `sandbox/poc/hkctl` (session scratchpad was wiped
  by a restart; reconstructed from history) with README covering the
  entitlement/TCC/scene-lifecycle gotchas.
- Plan archived to `packages/docs/archive/completed/`; deliberate leftovers in
  `packages/docs/todos/homekit-refresh-followups.md`.

### Remaining

- Everything open is tracked in `todos/homekit-refresh-followups.md`,
  `todos/litter-robot-sonoff.md`, and `todos/ha-integration-reauth.md`.

### Caveats

- The hkctl app itself must be rebuilt from source before next use (build
  artifacts were session-local).
- Kumo humidity sensors still `unknown` across two restarts — watch item.
