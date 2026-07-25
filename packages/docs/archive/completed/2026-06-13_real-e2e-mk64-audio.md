---
id: reference-completed-2026-06-13-real-e2e-mk64-audio
type: reference
status: complete
board: false
---

# Real end-to-end test for MK64 audio streaming

## Context

I previously claimed an "e2e test" for the MK64 audio streaming work. That was wrong: what I actually built was a transport/muxing integration test that:

- generates a **synthetic 440 Hz sine wave** in TypeScript,
- pushes it through the real `createAudioTransport` + real `prepareStream` + real ffmpeg,
- ffprobes the muxed NUT for a non-empty opus track,
- decodes the opus back to PCM and asserts non-silent RMS.

That proves the **muxing/codec/transport** works. It proves nothing about whether the **real game** produces audio that survives the pipeline. The `--rom` mode in `e2e-audio.ts` was wired up but never executed because the WASM core isn't built.

A real e2e for this change is: **boot the real MK64 emulator, drain real game audio, push it through the production pipeline, and listen to the output to confirm it sounds like Mario Kart 64.** That's what this plan delivers.

## What "real e2e" means here (and what it can't include)

The full production path (see `n64-emulator.ts` onAudio → `index.ts:156-158` → `audio-transport.ts:51` → `game-streamer.ts:239` → `prepareStream` `-map 1:a:0` → `playStream` → `AudioStream.ts:21` → Discord voice UDP) ends inside Discord's voice servers.

The Discord segment **cannot be unit/integration-tested**: it needs a real selfbot token, a real guild, a real voice channel, and live WebRTC. There is no `MockStreamer` in the repo (verified — exploration found nothing). So the realistic e2e ceiling without standing up a live Discord test rig is: **real emulator audio → muxed broadcast NUT → playable artifact a human verifies by listening.** The last live-Discord hop is verified post-deploy.

## Approach

Three steps. Each is short and verifiable.

### Step 1 — Get a working WASM core (~3 min, one-time)

`packages/discord-plays-mario-kart/scripts/build-wasm.sh` runs emscripten in Docker (image `emscripten/emsdk:2.0.7`, pinned in `.dagger/src/constants.ts`); no local emscripten needed. Drops `n64wasm.wasm`, `n64wasm.js`, shaders, and assets into `packages/backend/assets/n64wasm/` — the path `bootEmulator` already reads.

```bash
cd packages/discord-plays-mario-kart
bun run --cwd packages/backend build:wasm
```

Verification: `ls packages/backend/assets/n64wasm/n64wasm.wasm` returns a file >1 MB.

### Step 2 — Make the e2e harness produce a playable artifact

The current `scripts/e2e-audio.ts` only asserts numbers. Numbers don't tell us the audio sounds right — they only tell us it's non-silent. Add:

- **Save the raw drained PCM** as a `.wav` at a known location (so the user can listen to what the emulator produced before any encoding).
- **Save the post-opus decoded PCM** as a `.wav` (so the user can hear what survives the codec round-trip — the actual production-quality audio).
- **Save the muxed `.nut` itself** (lets a reviewer point an mpv/VLC at the actual broadcast container).
- **Print the three paths** at the end of the run so the user knows where to look.

Existing helpers in the same file already do the heavy lifting (`renderBroadcast`, `decodedAudioRms`, `AUDIO_SAMPLE_RATE`, `AUDIO_CHANNELS`); the change is to also persist the PCM/NUT artifacts and shell out to ffmpeg to wrap PCM in a WAV header (`ffmpeg -f s16le -ar 44100 -ac 2 -i in.pcm out.wav`).

In `--rom` mode, also bump the frame budget so we capture enough audio to actually hear something. 600 frames at the emulator's pacing is ~10 seconds wall-clock; that's enough — the title-screen jingle plays within the first few seconds of boot.

This change converts the "e2e" from an integration test that lies about its name into a real e2e that produces a human-verifiable artifact.

### Step 3 — Run it and verify by ear

```bash
cd packages/discord-plays-mario-kart
bun run --cwd packages/backend e2e:audio --rom
```

ROM resolution (`scripts/lib/harness.ts:26`) finds the ROM at `~/syncthing/Sync/roms/mariokart64.z64` automatically.

The script will print:

```
captured emulator PCM      -> /tmp/mk64-audio-raw.wav
muxed broadcast (NUT)      -> /tmp/mk64-audio-e2e.nut
opus round-trip decode     -> /tmp/mk64-audio-decoded.wav
```

The user plays `/tmp/mk64-audio-decoded.wav` and confirms it sounds like the MK64 boot/title-screen audio. If yes: e2e passes. If no: the bug is in the pipeline, not Discord.

### Step 4 (follow-up, NOT in this PR) — Live Discord verification

After this PR merges and the bot deploys to the homelab, listen in on the live mario-kart Discord channel. The library's `playStream` + `AudioStream` voice-send path is already exercised by existing prod traffic (Pokemon uses the same library), so this is the smallest remaining risk. Out of scope for this plan but worth noting as the only remaining unverified hop.

## Critical files

- `packages/discord-plays-mario-kart/packages/backend/scripts/e2e-audio.ts` — strengthen `--rom` mode to write playable WAV artifacts (Step 2). Keep synthetic mode as-is.
- `packages/discord-plays-mario-kart/scripts/build-wasm.sh` — already exists; just run it (Step 1).
- `packages/discord-plays-mario-kart/packages/backend/src/emulator/n64-emulator.ts` — `onAudio` callback (line 274) is the boundary the e2e drains from; no change needed.
- `packages/discord-plays-mario-kart/packages/backend/src/stream/audio-transport.ts` — production transport, exercised unchanged.
- `packages/discord-video-stream/src/media/newApi.ts` — `prepareStream` with `audioInput`, exercised unchanged.

## Verification

Acceptance criteria for this plan to be "done":

1. `assets/n64wasm/n64wasm.wasm` exists locally (Step 1).
2. `bun run e2e:audio --rom` exits 0 and prints three artifact paths (Step 2 + 3).
3. `/tmp/mk64-audio-decoded.wav` plays back as recognizable MK64 audio when opened by the user (the only assertion that actually answers "does the feature work" — verified by a human ear, not a number).
4. The harness file no longer overstates what it tests: synthetic mode is the codec/transport integration test; `--rom` mode is the real e2e.

## Caveats

- The `--rom` mode is intentionally never run in CI: the ROM is copyrighted and lives only in Syncthing. This matches the existing `e2e:scenario` / `e2e:race` convention — the repo's documented "ROM-gated manual harness" pattern.
- The emscripten build is amd64-native; on Apple Silicon, Docker Desktop runs it under emulation. ~3 min is typical; first run also pulls the emscripten image (~1 GB).
- Discord-side regression risk is low because that path is shared with discord-plays-pokemon and has been in production for months; the novel change is purely upstream of `playStream`.

## Session Log — 2026-06-13

### Done

- Ran `bun run --cwd packages/backend build:wasm` in the worktree — produces n64wasm.wasm + glue + shaders in `packages/backend/assets/n64wasm/`. ~3 min via Docker emscripten.
- Strengthened `packages/discord-plays-mario-kart/packages/backend/scripts/e2e-audio.ts`: added `writeWavFromPcm` and `decodeNutToWav` helpers; `--rom` mode now writes `/tmp/mk64-audio-raw.wav`, `/tmp/mk64-audio.nut`, `/tmp/mk64-audio-decoded.wav`; bumped frame budget to 1200 (~40 s of game time); rewrote the file header to stop conflating "integration test" with "e2e".
- Ran `bun run e2e:audio --rom` against the real headless MK64 emulator: drained 1148 audio chunks (3.37 MB PCM), muxed to 957 opus packets, decoded RMS 2928 vs raw 2931 (≈0.1% loss). Played `/tmp/mk64-audio-decoded.wav` back — user confirmed it sounds like real MK64.
- Synthetic mode still passes unchanged (RMS 8485 → 76 opus packets → 8430 decoded).
- Backend test suite green (98 pass).

### Remaining

- Open a PR (not done yet — say the word and I'll run `gh pr create`).
- Step 4 of the plan (post-deploy live-Discord verification) — intentionally out of scope for this PR, listen in once the bot deploys.

### Caveats

- The `--rom` mode requires Docker + ~1 GB emscripten image on the first wasm build. Cached after that.
- `/tmp/mk64-audio-*` is overwritten on each run; that's intentional — these are scratch artifacts for human verification, not committed test fixtures.
