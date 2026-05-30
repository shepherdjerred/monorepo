# Home Assistant routine tweaks (Temporal)

## Status

Complete

Adjustments to the four Temporal-driven Home Assistant routines in
`packages/temporal/src/workflows/ha/`, per user request.

## Changes

| Routine | Change | Files |
| --- | --- | --- |
| Morning — early | Removed `goodMorningEarly`; the 60-min bathroom heat cycle now runs inside `goodMorningWakeUp`. The separate pre-wake schedules (weekday 7 AM / weekend 8 AM) were deleted. | `good-morning.ts`, `index.ts`, `register-schedules.ts`, `register-schedules.test.ts` |
| Morning — wake up | Starts the heat cycle first (set 30°C), runs the wake media/scene, then holds `MORNING_HEAT_DURATION` (60 min) and turns heat off. Added `media_player.shuffle_set { shuffle: true }` after `play_media` so the wake favorite (FV:2/5) shuffles. Wake schedule timeout bumped 30 → 75 min. | `good-morning.ts`, `register-schedules.ts`, `register-schedules.test.ts` |
| Morning — get up | Dropped `media_player.entryway` from the multi-room join; only `media_player.main_bathroom` joins the bedroom now. | `good-morning.ts` |
| Coming home | `welcomeHome` now fires on **every** arrival (not just first-into-empty-house). Always unlocks the door + turns on lights (living-room scene + entryway/front-door when dark). The "Welcome back" notification and vacuum-docking are gated behind a new `firstArrival` arg (true only when the house was otherwise empty). | `welcome-home.ts`, `index.ts`, `event-bridge/triggers.ts` |

## Verification

- This fresh worktree was missing `node_modules` for the `@shepherdjerred/llm-observability`
  workspace dep (and its own deps), which broke `tsc` + two unrelated test files
  (`github-webhook`, `agent-task-api`). Fixed with `bun install` in both
  `packages/temporal` and `packages/llm-observability`. Unrelated to these changes.
- `bunx tsc --noEmit` — clean (exit 0, zero errors).
- `bun test src/event-bridge src/schedules src/workflows` — 45 pass / 0 fail.
- `bunx eslint` on all changed files — clean.

## Good night — iOS AirPlay myNoise via Hue button (answer, not implemented)

User asked whether the good-night audio could be the **myNoise iOS app**
AirPlayed from the iPhone, triggered by a **Hue button**.

- **Hue button → trigger:** Easy and compatible with the existing event-bridge.
  Expose the Hue Dimmer/Smart button to HA (via the Hue bridge), then add an
  event trigger in `triggers.ts` exactly like the existing iOS-action
  `goodNight` trigger.
- **myNoise AirPlay:** The blocker. The myNoise iOS app exposes **no API and no
  Shortcuts actions**, so you cannot script "open myNoise, pick a soundscape,
  press play." iOS Shortcuts can at most `Open App: myNoise` +
  `Set Playback Destination` to an AirPlay 2 speaker — you'd still tap play
  manually, and the soundscape isn't selectable. AirPlaying the phone also ties
  playback to the phone (battery, Wi-Fi, interrupted by calls).
- **Recommended:** Keep audio on Sonos like the current `goodNight` does. Save a
  myNoise-style soundscape as a Sonos favorite and play it via the existing
  `play_media` path; then Hue button → HA event → Temporal `goodNight` works
  end-to-end with no phone involvement. (Not implemented — needs the user to
  decide and to set up the Hue button + favorite.)

## Session Log — 2026-05-30

### Done

- Folded bathroom heat into `goodMorningWakeUp`; removed `goodMorningEarly` and
  its two schedules; bumped wake timeout to 75 min and updated the timeout test.
- Added shuffle to the wake-up media.
- Removed entryway speaker from the get-up multi-room group.
- Made `welcomeHome` always unlock + light on every arrival, gating the
  notification + vacuum-dock behind `firstArrival`; trigger now fires on every
  `not_home → home` and passes `firstArrival`.
- Verified: tsc clean (exit 0), 45 tests pass, eslint clean.

### Remaining

- Good-night Hue-button/myNoise idea: answered with options above; no code
  written pending a user decision (recommend Sonos-favorite path over AirPlay).

### Caveats

- Heat now starts at **wake time** and runs ~60 min, rather than pre-heating
  before wake as the old `early` routine did. The bathroom will be warming up
  *as* you wake rather than already warm.
- A fresh worktree/clone needs `bun run scripts/setup.ts` (or per-package
  `bun install`) before typecheck/test — `@shepherdjerred/llm-observability` and
  its deps weren't installed here and broke `tsc` + two unrelated test files
  until installed.
