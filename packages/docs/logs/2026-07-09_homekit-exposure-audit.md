# HomeKit Exposure Audit

## Status

Complete (pending PR merge)

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
