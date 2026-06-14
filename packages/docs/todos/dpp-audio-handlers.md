---
id: dpp-audio-handlers
status: blocked
origin: packages/docs/plans/2026-06-13_dpp-audio.md
---

# discord-plays-pokemon — audio is blocked at the wasm-source level

## TL;DR

The upstream `tripplyons/pokeemerald-wasm` source **intentionally stubs out the entire audio engine** in its wasm build. PR #1181 lands all the host-side plumbing (handlers, driver, harness, analysis tooling) — but the wasm itself contains no mixer to call our handlers, so no PCM will ever be produced against the current vendored wasm.

Audible audio requires **rebuilding the wasm with audio enabled** OR porting the full m4a engine to TypeScript (the wasm-side path is the realistic one).

## Evidence

`src/m4a.c` in `tripplyons/pokeemerald-wasm` has a `#if WASM` block that replaces the entire audio runtime with empty stubs. Verbatim, lines 48-81:

```c
#if WASM
void m4aSoundVSync(void) {}
void m4aSoundVSyncOn(void) {}
void m4aSoundVSyncOff(void) {}
void m4aSoundInit(void) { SoundInit(&gSoundInfo); }
void m4aSoundMain(void) {}              // ← the mixer is a NO-OP
void m4aSoundMode(u32 mode) {}
void m4aSongNumStart(u16 n) { ... WasmMPlayStart(&gMPlayInfo_BGM); ... }
...
void MPlayMain(struct MusicPlayerInfo *mplayInfo) {}   // ← the per-track interpreter is a NO-OP
void SoundInit(struct SoundInfo *soundInfo) { if (soundInfo != NULL) soundInfo->ident = ID_NUMBER; }
void SoundMain(void) {}                  // ← the per-sample mixer is a NO-OP
void SoundMainBTM(void) {}
u32 MidiKeyToFreq(struct WaveData *wav, u8 key, u8 fineAdjust) { return 0; }
```

The real implementations (1700+ lines covering `m4aSoundMain`, `MPlayMain`, `MidiKeyToFreq`, song parsing, channel allocation, fade logic, etc.) live in the `#else` branch of the same file (lines 84-1843). The wasm build's `#define WASM=1` selects the stubs.

Confirmed empirically:

- After `SoundInit(&gSoundInfo)`, `m4aSoundMain` (called per-frame from our driver) modifies **zero bytes** of linear memory.
- Manually arming `gSoundInfo.chans[0]` with `SF_START | SF_STOP | ENV_ATTACK`, a valid waveform pointer, frequency, and envelope state, then calling `SoundMain` directly: still **zero bytes modified**. Both `SoundMainRAM_Buffer` and `gSoundInfo.pcmBuffer` stay all-zero across every entry point (`SoundMain` / `SoundMainBTM` / `m4aSoundMain`).
- No pointer to `gSoundInfo` exists anywhere in linear memory; `SOUND_INFO_PTR @ 0x03007FF0` is `0` after init. Writing `gSoundInfo`'s address there doesn't change behavior — because the C functions that would dereference it are no-ops.
- `ply_*` imports are never called by the wasm: the C-side dispatcher (`MPlayMain`) that would invoke them is itself a no-op.

## Path forward (recommended)

**Rebuild the wasm with audio enabled.** Specifically:

1. Patch `src/m4a.c` in the upstream `tripplyons/pokeemerald-wasm` source so the `#if WASM` block does NOT stub out the audio engine. Either:
   - Delete the `#if WASM` block entirely (lines 24-82); or
   - Replace it with a much smaller block that stubs only `m4aSoundVSync*` (the VBlank-IRQ-specific functions) and keeps the real `m4aSoundMain` / `MPlayMain` / etc.
2. After patching, the wasm-side C engine still references ARM-assembly-only symbols defined in `src/m4a_1.s`: `SoundMain` (the actual PCM mixer), `umul3232H32`, and all 33+ `ply_*` track-command handlers. `clang --target=wasm32-unknown-unknown` cannot compile that file. `wasm-ld --allow-undefined` is what surfaces them as wasm function imports.
3. **Provide TS implementations** for those imports:
   - 33 `ply_*` handlers, `FadeOutBody`, `TrackStop`, `SampleFreqSet`, `TrkVolPitSet`, `SetPokemonCry*`, `IsPokemonCryPlaying` — **already done in PR #1181** (`src/emulator/audio/m4a-handlers-*.ts`).
   - `SoundMain` — the actual ARM-asm PCM mixer (`m4a_1.s` lines ~25-500). Iterate `gSoundInfo.chans[0..maxChans-1]`, advance each active channel's sample position by `chan.frequency / mixer-rate`, fetch s8 from `chan.wav.data[count]`, apply envelope, mix into `pcmBuffer`. The C-equivalent is in `agbplay/src/MP2KSoundMixer.cpp` for reference. ~200-400 LOC TS, math-heavy but bounded.
   - `umul3232H32` — trivial: `(a * b) >>> 32` with bigint.
   - `CgbSound` / `CgbOscOff` / `MidiKeyToCgbFreq` — PSG (Game Boy native) channels. Stub to no-ops first; Pokemon Emerald uses these for some cries / SFX but the BGM is all Direct Sound, so silence-stubbing won't break BGM.
4. Re-vendor the new wasm via `scripts/fetch-wasm.ts` (the SHA pin in `pokeemerald.wasm.sha256` ratchets to whatever we built).
5. End-to-end verification: run `bun run scripts/audio-e2e.ts --update-baseline` after a human listen, commit the baseline WAV under `src/__tests__/fixtures/`, and the mel-fingerprint test (already wired) becomes the regression gate.

Set up reference:

- Build env: `clang --target=wasm32-unknown-unknown` + `wasm-ld --allow-undefined --no-entry --export-all`. Full Makefile is at `tripplyons/pokeemerald-wasm/Makefile`. Dependencies beyond clang/wasm-ld: `libpng`, `libz`, `uv` (Python).
- Build trips on graphics asset generation (`gbagfx` tool) first. Pre-built assets can be cached.
- Full build takes ~5 minutes on an M-series Mac once deps are in place.

## Path forward (alternative)

**Port the full m4a engine to TypeScript.** The real C-side implementation in `tripplyons/pokeemerald-wasm/src/m4a.c` `#else` branch is the source of truth (~1700 LOC of C, plus the asm-only mixer that's an additional ~500 LOC). Run our own engine entirely in TS:

1. Per frame, read game state (gMPlayTable, song headers) from wasm memory.
2. Run TS-side `MPlayMain` (interprets track commands), invokes our existing ply\_\* handlers, advances envelopes.
3. Run TS-side `SoundMain` (mixes channels into PCM).
4. Emit PCM via the existing `onAudio` callback.

Pros: no wasm-build dependency, fully under our control.
Cons: ~2-3 KLOC of new TS code, must mirror the C engine faithfully or audio is wrong.

## What's already done (in PR #1181)

- `src/emulator/audio/m4a-structs.ts` — byte-offset tables for every m4a struct.
- `src/emulator/audio/m4a-memory.ts` — typed wasm-memory views.
- `src/emulator/audio/m4a-handlers-{basic,flow,note,env,note-on,ext}.ts` — all 40+ track-command handlers ready to fire once a real mixer in the wasm calls them.
- `src/emulator/audio/m4a-driver.ts` — per-frame `m4aSoundMain` invocation + PCM drain + bootstrap (`SoundInit` + `m4aSoundMode` + direct gSoundInfo fields).
- `src/emulator/audio/analysis.ts` + `wav.ts` — FFT / mel filterbank / chromagram / onset detection / floor checks + WAV reader/writer. 8 sanity tests.
- `scripts/audio-e2e.ts` — boot wasm → drain PCM → ffmpeg libopus encode → decode → roundtrip WAV. End-to-end pipeline runs cleanly (output is silent until the wasm has a real mixer).
- 100/100 tests, typecheck + lint clean.

## What blocks audible audio

Pure source-level: the wasm doesn't have an audio engine in it. Nothing the host can do at runtime fixes this — every attempt at runtime patching (writing `gSoundInfo` fields, populating `SOUND_INFO_PTR`, manually arming SoundChannels) is no-op against C functions whose bodies are empty.
