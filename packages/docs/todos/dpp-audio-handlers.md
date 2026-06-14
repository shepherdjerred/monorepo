---
id: dpp-audio-handlers
status: active
origin: packages/docs/plans/2026-06-13_dpp-audio.md
---

# discord-plays-pokemon — remaining m4a handler implementations

Phase 2a of the audio port landed the engine scaffold + simple parameter setters. The rest of Phase 2 is implementing the handler categories below. All listed names live as imports the wasm calls; they currently return `0` from `packages/discord-plays-pokemon/packages/backend/src/emulator/audio/index.ts`, which keeps the wasm running but produces silent PCM.

Plan: `packages/docs/plans/2026-06-13_dpp-audio.md`.
Reference: `pret/pokeemerald` `include/gba/m4a_internal.h` (struct layouts) + `ipatix/agbplay` (algorithm reference; do not copy verbatim).

## Categories to complete

### Control flow + memacc (`m4a-handlers-flow.ts`)

Track-command dispatch + branching. Critical for any song to advance past the first opcode.

- `ply_goto` — absolute jump (4-byte ptr).
- `ply_patt` — call subpattern: push current `cmdPtr` to `patternStack[patternLevel]`, increment `patternLevel`, set new `cmdPtr` from 4-byte arg.
- `ply_pend` — return from subpattern: decrement `patternLevel`, pop `cmdPtr` from stack.
- `ply_rept` — repeat-N: 1-byte count + 4-byte target; track per-track `repN`.
- `ply_memacc` — memory accumulator op (op-byte + addr + data, into `gMPlayMemAccArea`).
- `TrackStop` — stop a single track on a `MusicPlayerInfo`.

### Envelope + LFO state machines (`m4a-handlers-env.ts`)

Per-frame envelope progression. Without these, even if notes start they have no shape.

- `FadeOutBody` — fade-out tick on `MusicPlayerInfo` (uses `fadeOI`/`fadeOC`/`fadeOV`).
- `ply_port` — portamento (slide) setup; updates `tone.pan_sweep` and bend state.
- LFO/mod follow-up: the current `ply_lfos`/`ply_mod` setters write the value but the per-frame LFO tick (advancing `lfoSpeedC`, applying to bend/vol/pan) lives in the channel-update path.
- `TrkVolPitSet` — recompute combined volume + pitch on a track; called by the mixer when `MPT_FLG_VOLCHG`/`PITCHG` is set.

### Voice / instrument + ADSR setters (`m4a-handlers-note.ts`)

Note-on path. Without these, no audible notes ever start.

- `ply_voice` — switch instrument (1-byte voice index; copies `ToneData` from voice group into track's embedded `tone`).
- `ply_xwave` — direct-sound waveform pointer (4-byte ptr).
- `ply_xtype` — wave type (1 byte).
- `ply_xatta` / `ply_xdeca` / `ply_xsust` / `ply_xrele` — ADSR attack/decay/sustain/release.
- `ply_endtie` — terminate a tied note (1-byte key).

### Note opcode + extended dispatch (`m4a-handlers-ext.ts`)

- `ply_note` — opcode 0xCF and ≥; the actual "play a note" handler. Takes a note-cmd byte (encodes length), reads key + velocity + gate-time bytes.
- `ply_xxx` — extended-cmd prefix (0xCD); reads the xcmd byte and dispatches via the xcmd table.
- `ply_xcmd` — xcmd dispatcher (used as a generic catch from `ply_xxx`).
- `ply_xiecv` / `ply_xiecl` — pseudo-echo volume / length (cheap; can be done with the basic setters).
- `ply_xleng` / `ply_xswee` / `ply_xwait` / `ply_xcmd_0D` — extended note-length / sweep / wait / reserved.

### Engine control

- `SampleFreqSet(u32 freq)` — set the mixer's PCM rate. Writes `gSoundInfo.freq` + `pcmFreq` + `pcmSamplesPerVBlank` from `gFreqTable[freq]` + `gPcmSamplesPerVBlankTable[freq]`. The wasm exports these tables as data globals; we'll need their addresses.

### Pokémon cry family

All 11 `SetPokemonCry*` + `IsPokemonCryPlaying`. They drive `gMPlay_PokemonCry` and patch fields in the `gPokemonCrySong` template per-cry. `IsPokemonCryPlaying` currently returns `0` so callers don't block; this is per-upstream-design fallback behavior.

## Verification gate

Phase 5 of the plan: render real PCM, listen + mel-spectrogram fingerprint match against a committed Pokemon Emerald title-BGM baseline. The full handler set is what unlocks that gate going green.
