# MK64 — fix `/screenshot` transparency + stream red/blue swap

## Status

Complete (code + automated verification; live Go-Live colour confirmation pending — needs the real ROM + a Discord channel)

## Context

`packages/discord-plays-mario-kart` runs N64Wasm (parallel-n64 + **angrylion software RDP**) headless in Bun and reads the software framebuffer straight out of wasm linear memory. Two visible defects:

1. **`/screenshot` has transparency** — colours are correct, but the PNG carries an alpha channel whose bytes come from angrylion's **XRGB8888** padding (never initialised → `memset(0)`), so the image renders (partly/fully) transparent.
2. **Video stream is colour-shifted (R↔B)** — ffmpeg is told the rawvideo input is `rgba`, but the bytes reaching it are BGRA.

### Root cause

angrylion's `struct rgba` is `b,g,r,a` (`vdac.h`); the `a` byte is XRGB8888 padding, never written. `get_video_buffer()` (`wasm-src/.../libretronew.c:1522`) does a **non-idempotent, in-place `b`↔`r` swap** on the live `prescale` buffer. The TS host calls it a _variable_ number of times per frame, so the two consumers observe **different channel orders**:

- **Stream** (`onFrame`, read every tick) → bytes at ffmpeg are **BGRA**.
- **Screenshot** (`renderFrame`, on demand) → bytes are **RGBA** (colours already correct).

Confirmed by the reporter: the screenshot's colours look fine (only transparency is wrong), while the video is R↔B swapped. The pipeline applies no other channel transform (`discord-video-stream/src/media/newApi.ts` only does `scale` + `yuv420p`), so the stream swap is purely the input `pix_fmt` mislabel.

## Fix (surgical — each consumer told the truth at its own boundary)

| File                                           | Change                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/src/stream/game-streamer.ts` | `-pix_fmt rgba` → `bgra`; rename the `rgba` PassThrough → `bgra` + accurate comments.                                                    |
| `packages/backend/src/emulator/png.ts`         | Emit PNG **colour type 2 (RGB)** — drop the dead XRGB byte. **Keep** RGBA→RGB verbatim mapping (screenshot colours are already correct). |
| `packages/backend/src/emulator/png.test.ts`    | New unit test: decodes the PNG and asserts colour type 2, no alpha, verbatim R,G,B, and nearest-neighbour upscale.                       |
| `packages/backend/eslint.config.ts`            | Add `src/emulator/png.test.ts` to `allowDefaultProject`.                                                                                 |
| `wasm-src/PATCHES.md`                          | Document the dead-alpha byte + the non-idempotent swap and the per-consumer channel order.                                               |

Deliberately **not** changed: the emulator read path. An earlier draft cached one read per tick and routed both consumers through it (would have unified the order), but the two paths genuinely observe _different_ orders today and the screenshot is currently correct — collapsing them risked breaking the working screenshot without real-hardware confirmation. Left as-is; see caveat.

## Verification

- `bunx tsc --noEmit` (backend) — clean. (Required building the fork first: `cd packages/discord-video-stream && bun run build` then reinstall, so tsc resolves `dist/*.d.ts` instead of the fork's `src`; otherwise an unrelated cross-env `@ts-expect-error` in the fork's `utils.ts` trips TS2578.)
- `bun test` (backend) — 5 pass / 0 fail (4 new png tests + existing config test).
- `bunx eslint` on changed files — clean.
- **Pending (needs ROM + Discord):** start a Go-Live broadcast and confirm stream colours; take `/screenshot` and confirm opaque + correct colours. Attach before/after screenshots to the PR per the visual-changes rule.

## Session Log — 2026-06-07

### Done

- Diagnosed both bugs to a single root cause: angrylion BGRA struct + uninitialised XRGB alpha + a non-idempotent in-place `b`↔`r` swap in `get_video_buffer()` that the host calls a variable number of times per frame (stream → BGRA, screenshot → RGBA).
- `game-streamer.ts`: `-pix_fmt` `rgba`→`bgra` (+ rename, comments).
- `png.ts`: RGB (colour type 2), drop the dead alpha byte; kept correct RGBA→RGB mapping.
- `png.test.ts`: new PNG decode test; registered in eslint `allowDefaultProject`.
- `PATCHES.md`: documented the format gotchas.
- Backend typecheck, tests, and lint all green.

### Remaining

- Live Go-Live colour confirmation + opaque `/screenshot` check on real hardware, with before/after PR screenshots.

### Caveats

- **Mid-correction:** the original plan assumed the screenshot was also BGRA and added a PNG red/blue swap + a determinism refactor. The reporter clarified the screenshot colours are correct — those changes were reverted; the final fix keeps the screenshot mapping verbatim and only strips alpha.
- **Latent fragility:** because the swap is non-idempotent and call-count-dependent, a `/screenshot` taken _while streaming_ may land on the opposite parity and come out R↔B swapped (the stream path does an extra read that frame). Not reproduced here (no ROM). The robust fix is to cache one read per tick and serve both consumers from it — but that must be validated against the real ROM to pick the unified `pix_fmt`/PNG mapping, since static analysis (1 swap ⇒ RGBA) and the observed stream order (BGRA) don't reconcile. Tracked as a follow-up.
- The fork's `dist/` must exist for the backend typecheck to pass (it's a build artifact; CI builds it). Fresh worktrees need `bun run build` in `packages/discord-video-stream` + reinstall.
