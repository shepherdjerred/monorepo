# MK64 screenshot — burn names in, shrink the timer overlay, ensure 4:3

## Status

Complete — PR #1182

## Context

User feedback on the `/screenshot` artifact (Discord slash command + web client) for **discord-plays-mario-kart**:

1. "Screenshot is still 16:9 rather than 4:3." Today's `/screenshot` path already encodes at **640×480 = 4:3** (`packages/discord-plays-mario-kart/packages/backend/src/emulator/screenshot.ts:3-4`), merged in PR #1152. Deployed image at planning time was `2.0.0-3960`; on roll-out the new image will carry both PR #1152 and the changes in this plan.
2. "Screenshot does not have the names burned in." Confirmed — the `/screenshot` path bypassed the per-frame overlay pipeline. Now routed through the same overlays the stream uses.
3. "Make the timer over smaller." The HUD timer (`"UTC HH:MM:SS.mmm 1..4"`) consumed ~84% of the 640 px frame width at `GLYPH_SCALE_X=4, GLYPH_SCALE_Y=2`. Shrunk to ~17% by dropping the `"UTC "` prefix and halving the scale to `2:1` (still square in display thanks to the framebuffer's anamorphic 2× horizontal).

Intended outcome: a fresh `/screenshot` returns a **4:3 PNG with the player-name pills the Go-Live stream renders, plus a much smaller HUD clock** — and the same smaller HUD lands on the live stream.

## Approach

### 1. Share the overlay pipeline between stream and screenshot

The mutation order in `index.ts:131-148` (HUD then name labels) lifted into a tiny helper:

- `packages/discord-plays-mario-kart/packages/backend/src/overlay/composite.ts` exports `applyStreamOverlays(frame, height, ctx)` and the shared `StreamOverlayContext` type.

Reused from:

- `index.ts` (live-stream path) — `activeEmulator.onFrame` now calls `applyStreamOverlays`.
- `discord/slashCommands/commands/screenshot.ts` (Discord `/screenshot`) — calls `applyStreamOverlays` on the rendered frame before `encodeScreenshotPng`.
- `webserver/dispatch.ts` (web `/screenshot`) — same.

The overlays write greyscale (HUD: black/white pixels; name pill: black background with white text), so they are R/B-symmetric and safe on the `/screenshot` RGBX buffer (the stream path is BGRA — see `wasm-src/PATCHES.md`).

`DispatchDeps` gained an `overlayContext?: StreamOverlayContextProvider`. `handleSlashCommands(emulator, overlayContext?)` and `makeScreenshot(emulator, overlayContext?)` were extended similarly. The provider is a thunk so each `/screenshot` reads the latest screen mode + seat-activity flags. `index.ts` constructs one shared `overlayContext` and threads it through both wiring points; tests pass `undefined` to keep the existing clean-frame assertions valid.

### 2. Shrunk the HUD timer overlay

In `stream/overlay.ts`:

| constant        | before | after |
| --------------- | ------ | ----- |
| `GLYPH_SCALE_X` | `4`    | `2`   |
| `GLYPH_SCALE_Y` | `2`    | `1`   |
| `PAD_X`         | `4`    | `2`   |
| `PAD_Y`         | `2`    | `1`   |

Also: dropped the `"UTC "` prefix from `formatUtcTimestamp` (the format `HH:MM:SS.mmm` is self-evidently a clock) and removed the now-unused `U`, `T`, `C` glyphs from `GLYPHS`.

Result: box width ~536 px → ~108 px (~17% of the 640 px frame); the 2:1 aspect ratio keeps each rendered dot square once the 640×240 frame displays at 4:3.

### 3. Verified the 4:3 deploy is in flight

PR #1152 already ships the 4:3 encoder; image `2.0.0-3960` already contains it. The PR that ships this plan will further include the overlays + smaller HUD.

## Files changed

- `packages/discord-plays-mario-kart/packages/backend/src/overlay/composite.ts` (new)
- `packages/discord-plays-mario-kart/packages/backend/src/stream/overlay.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/discord/slashCommands/commands/screenshot.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/discord/slashCommands/index.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/webserver/dispatch.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/index.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/stream/overlay.test.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/webserver/dispatch.test.ts`

## Verification

1. `bun run typecheck` (backend) — clean
2. `bun test` (backend) — 94/94 pass; new test asserts overlay'd vs. clean screenshots differ AND keep 640×480
3. `bun run lint` (backend) — clean
4. Post-merge smoke: take `/screenshot` in Discord and verify 4:3 dimensions, visible name pill, small HUD clock in top-left.

## Out of scope

- Removing the live-stream pillarbox (16:9 → native 4:3). The user complaint was the `/screenshot` artifact; the streamer keeps its 16:9 canvas.
- Re-styling the name pill (font, colors).

## Session Log — 2026-06-14

### Done

- Added `packages/discord-plays-mario-kart/packages/backend/src/overlay/composite.ts` with `applyStreamOverlays` + `StreamOverlayContext`.
- Routed `/screenshot` (Discord slash command + web dispatch) through `applyStreamOverlays`; live-stream loop now uses the same helper.
- Shrunk HUD clock: scale 2:1, padding 2:1, dropped `"UTC "` prefix and `U/T/C` glyphs.
- Extended `webserver/dispatch.test.ts` with an overlay-vs-clean screenshot diff assertion; updated `stream/overlay.test.ts` timestamps.
- Branch `feature/mk64-screenshot-overlays`, commit `271108f94`, PR #1182.

### Remaining

- Post-rollout smoke: visually confirm screenshot now shows names + smaller HUD clock once the next image bump lands.

### Caveats

- The `/screenshot` artifact only burns in names that have been claimed via the web UI (`setOverlayName`). Empty seats render no pill — by design, matching the live stream.
- If the screenshot path runs while `nameOverlay` is undefined (overlay feature disabled in config), the HUD clock still applies — the helper short-circuits at `nameOverlay?.apply`.
