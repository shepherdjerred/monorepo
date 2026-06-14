---
id: dpp-audio-handlers
status: active
origin: packages/docs/plans/2026-06-13_dpp-audio.md
---

# discord-plays-pokemon — m4a handler polish

The m4a TS port has landed end-to-end (PR #1181): all 47 audio imports are
wired with handler functions, the engine bootstrap (`SoundInit` +
`m4aSoundMode` + direct `gSoundInfo` write) reliably primes the mixer to
13379 Hz, the per-frame driver drains PCM out of `SoundMainRAM_Buffer` into
the `onAudio` callback, and the Phase-5 harness boots the wasm + renders +
encodes-to-Opus + decodes-back-to-WAV without errors.

**What does NOT yet work:** the captured PCM is all zeros. The mixer ticks
but produces silence because note-on does not actually arm a SoundChannel
with a valid waveform pointer and frequency.

## Where it breaks

`packages/discord-plays-pokemon/packages/backend/src/emulator/audio/m4a-handlers-note-on.ts`
ply_note is a placeholder: when the track has no allocated channel
(`track.chan == 0`), the handler only writes gateTime and returns. The real
m4a runtime walks `gSoundInfo.chans[0..maxChans-1]` looking for a free slot
or evicting a low-priority active slot, then:

1. Links `track.chan ← &chan`, `chan.track ← &track`.
2. Copies the embedded ToneData into the channel's per-sample DSP state.
3. Sets `chan.wav ← track.tone.wav`, `chan.frequency ← gFreqTable[octave] *
pitch-correction`, `chan.envelopeVolume ← 0`, `chan.statusFlags ←
SF_START | SF_STOP | ENV_ATTACK`.
4. Sets the running-status byte on the track so the dispatcher knows it
   consumed a note opcode.

Without step 1 (channel allocation), no subsequent ply_note ever arms a real
channel; without steps 2-3 (wave pointer + frequency), the mixer reads
zeros and writes zeros to the PCM buffer.

## What's missing for audible audio

1. **Channel allocator.** Pick the next free `SoundChannel` (statusFlags == 0) in `gSoundInfo.chans`; fall back to evicting the channel with the
   lowest priority + lowest envelope volume. Wire `track.chan` and
   `chan.track`.
2. **Frequency lookup.** Read `gFreqTable[]` (a wasm-exported global data
   array) and pick the right entry from the MIDI key + octave. The exact
   ARM-asm computation is in `pret/pokeemerald` `sound/m4a/m4a_2.s`
   (`MidiKeyToFreq`).
3. **TrkVolPitSet — pitch path.** The current impl only computes the stereo
   volume; it needs to recompute `chan.frequency` when MPT_FLG_PITSET is
   set (track keyShift / tune / bend changed mid-note). Otherwise pitch
   bends and slides are dropped.
4. **LFO mod application.** The setters write LFO speed / depth, but the
   per-tick LFO advance (`lfoSpeedC` counter + applying `modM` to
   pitch/vol/pan) lives in the wasm mixer — which means it works
   automatically IF our setters write the right fields. Verify by
   capturing PCM from a known-LFO song and inspecting the modulation
   envelope.
5. **ply_voice → tone copy verification.** The handler copies the 12-byte
   ToneData verbatim; verify field offsets match the wasm's actual struct
   layout (potential off-by-one if emscripten pads differently from the
   header's `ALIGNED(4)` annotations).
6. **Channel-side envelope init.** When a channel arms a note, the wasm
   mixer's per-channel ChnInit routine sets envelope defaults. Confirm we
   don't need to mirror that work in `ply_note`.

## Verification gate

Once notes are arming correctly, the Phase-5 mel-spectrogram fingerprint
test gates regression: compare `scripts/audio-e2e.ts`-captured PCM against
a committed Pokemon Emerald title-BGM baseline. Refresh with
`bun run scripts/audio-e2e.ts --update-baseline` after a manual `afplay`
confirms the audio sounds right.

## Where to read for reference

- Struct layouts: `pret/pokeemerald` `include/gba/m4a_internal.h` (lines 130
  `SoundChannel`, 272 `MusicPlayerTrack`, 185 `SoundInfo`).
- Algorithm reference: `ipatix/agbplay` C++ reimplementation. Read for
  semantics; do not copy verbatim (license incompatible).
- Original ARM source: `pret/pokeemerald` `sound/m4a/m4a_1.s` +
  `m4a_2.s` (channel allocation, MidiKeyToFreq, envelope advance).
