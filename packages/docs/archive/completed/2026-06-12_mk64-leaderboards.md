# Mario Kart 64 Leaderboards

## Status

Complete — shipped in PR #1177.

## Context

`discord-plays-mario-kart` streams headless MK64 (N64Wasm: parallel-n64 + angrylion) to Discord; players drive seats P1–P4 from a React web UI over Socket.IO. This feature adds: players type a name in the web UI, names are burned into the stream per-viewport, race results are read from emulator RAM when a race finishes, persisted to SQLite, and shown as a small leaderboard in the web UI.

**Decisions:** layout-aware JS blit for the name overlay (not ffmpeg drawtext); Prisma + libSQL (birmel pattern); rank by wins + races played; free-text name as case-insensitive identity, schema ready for a future `discordId`.

## Architecture

```
onFrame(frame BGRA 640x240, copy) ─► NameOverlay.apply()  [sync blit, µs]
                                  ─► streamer.pushFrame()
                                  ─► RaceTracker.onFrame()  [poll RDRAM every N frames]
                                          └─► RaceWatcher (pure FSM) ─done─► Prisma store ─► broadcast leaderboard
```

- New wasm patch `0003-rdram-export.patch` exposes `neilGetRdram`/`neilGetRdramSize` (references `g_rdram` directly — this build links `libretronew.c`, which has no `retro_get_memory_data`).
- The framebuffer is a horizontally-doubled 320×240, so labels are drawn 2× wider than tall to read square on the displayed 4:3 stream (matches the HUD's `GLYPH_SCALE_X = 2 * GLYPH_SCALE_Y`).

## MK64 (US ROM) memory map — verified in-emulator 2026-06-12

Byte order: mupen64plus stores RDRAM as host-endian u32 words. u8 @ A → `heap[base + (phys ^ 3)]`; u16 → LE at `phys ^ 2`; u32 → LE at `phys & ~3`. All in `src/emulator/mk64-memory.ts`.

| What                     | Address               | Type    | Notes                                                                          |
| ------------------------ | --------------------- | ------- | ------------------------------------------------------------------------------ |
| `gGamestate`             | `0x800DC50C`          | s32     | 4 = racing                                                                     |
| race phase               | `0x800DC510`          | **s32** | 0–2 staging, 3 racing, 4/5 finished, 6 quitting (verified; full word, not u16) |
| `gMenuSelection`         | `0x800E86A0`          | s32     | **14 = player race**; attract demo races at 8 — gates out the demo             |
| `gActiveScreenMode`      | `0x800DC52C`          | s32     | 0 1p / 1 2p-horiz / 2 2p-vert / 3 quad                                         |
| `gPlayerCountSelection1` | `0x800DC538`          | s32     | 1–4                                                                            |
| `gModeSelection`         | `0x800DC53C`          | s32     | 0 GP, 1 TT, 2 VS, 3 Battle                                                     |
| `gCurrentCourseId`       | `0x800DC5A0`          | s16     | 0x00–0x14                                                                      |
| `gPlayers[8]`            | `0x800F6990` +`0xDD8` | —       | `type`+0x00 (0x4000 HUMAN), `currentRank`+0x04 (0-based), `characterId`+0x254  |
| `playerHUD[4]`           | `0x8018CA70` +`0x84`  | —       | `someTimer`+0x08 (u32 cs, latched at finish), `raceCompleteBool`+0x70 (s8)     |

Key correction during implementation: the documented race-phase value `D_800DC510` reads 0 during the attract demo's races, so detection gates on `gMenuSelection == 14` (player-initiated race) in addition to `gGamestate == 4`.

## What landed

- **wasm**: `wasm-src/patches/0003-rdram-export.patch`, `PATCHES.md` (incl. byte-order contract), `n64-emulator.ts` `rdram()` accessor.
- **memory reader**: `src/emulator/mk64-memory.ts` (+ test) — addresses, read helpers (numeric bounds-checked), `readSnapshot`.
- **race capture**: `src/leaderboard/race-watcher.ts` (pure FSM, 3-poll debounce, roster frozen at race start, + test) and `race-tracker.ts` (frame-loop poller, fire-and-forget persist).
- **persistence**: `prisma/schema.prisma` (`Race` + `RaceResult`, `#generated/prisma/client` output), `prisma.config.ts`, `src/database/index.ts` (singleton), `src/leaderboard/store.ts` (+ in-memory libSQL test). TT excluded from ranking; unnamed seats recorded with null key, excluded from the board.
- **overlay**: `src/overlay/{label-renderer,blit,layout,name-overlay}.ts` (+ blit/layout tests). sharp rasterizes the bundled `arial.ttf` via `fontfile` (no system fonts needed; `fontconfig` added to the image); premultiplied BGRA, 2× horizontal pre-stretch, viewport-corner placement per screen mode.
- **protocol**: `common/src/model/leaderboard.ts` (`name-set`, `leaderboard`, `PlayerNameSchema`); `seats` broadcast gains `names`; `seat-manager.ts` tracks names; `dispatch.ts` handles both + broadcasts a fresh board after each race.
- **frontend**: `name-entry.tsx` (localStorage, auto-resend on claim), `leaderboard.tsx` (live table), `app.tsx` wiring + names on seat buttons.
- **config/deploy**: `[leaderboard]` config block (`.prefault({})`); homelab `mario-kart.ts` 1 Gi data PVC + `DATABASE_PATH`; `setup.ts` + `.dagger/src/image.ts` (generate + `db push` at boot) + reference `Dockerfile`; `scripts/ci` `PRISMA_PACKAGES`.
- **e2e**: `scripts/e2e-race.ts` — drives a real race, dumps parsed snapshots, and (`OVERLAY=1`) burns names onto dumped PNGs.

## Verification

- Unit (CI): mk64-memory, race-watcher, store (in-memory libSQL), blit, layout, dispatch (name-set/leaderboard) — all green (83 backend tests). typecheck + eslint clean across backend/common/frontend; homelab + ci-generator typecheck/test green.
- Manual e2e with `~/Downloads/Mario Kart 64 (USA).z64`: attract demo never trips race detection; scripted nav reaches `menu → staging → racing` with course 8 (Luigi Raceway); name "Jerred" burned into the live frame; web UI shows the populated leaderboard + name entry.

## Manual step (post-merge)

Add a `[leaderboard]` block with `enabled = true` to the 1Password `config.toml` item (`fcugoc3kohpmfwzfvko4hgysyq`). Until then the schema default keeps `enabled = false`, so the deployed bot validates config but records nothing.

## Caveats

- The rebuilt `n64wasm.{js,wasm}` is gitignored; CI rebuilds it from `wasm-src/` + patches in the Dagger emscripten stage.
- Race-phase value semantics were verified on the US ROM only; addresses are US-ROM-specific.
- Multi-player overlay placement (2p/quad) is unit-tested via `layout.ts`; the manual screenshot was a 1p race (bottom-right of fullscreen).

## Session Log — 2026-06-12

### Done

- Implemented the full feature on `feature/mk64-leaderboards` (files above). 83 backend tests pass; typecheck/eslint clean (backend/common/frontend/homelab/ci).
- Validated the RDRAM map + endianness against the real US ROM; corrected race detection to gate on `gMenuSelection == 14` and the race phase to a full s32.

### Remaining

- Open the PR with both screenshots; flag the 1Password `[leaderboard] enabled = true` manual step for post-merge.

### Caveats

- See Caveats above (gitignored wasm, US-ROM-only addresses, 1p-only manual overlay screenshot).
