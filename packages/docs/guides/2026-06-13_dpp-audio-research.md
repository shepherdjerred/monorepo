# Discord Plays Pokémon — Audio Path Research

## Status

Complete (research).

## Executive Summary

There is **one clear winner**: rebuild our vendored wasm from
[`ottohg/pokeemerald-wasm`](https://github.com/ottohg/pokeemerald-wasm), a fork
of `tripplyons/pokeemerald-wasm` whose first audio commit landed
**six days ago** (`9a251a2`, 2026-06-07) and has been hardening continuously
since. ottohg added an in-tree C port of the asm-only m4a engine
(`src/m4a_wasm.c`, ~1500 LOC) plus `--export=gSoundInfo`/`gWasmPcmL/R`, leaving
the wasm responsible for actually producing PCM in the exact same
`SoundInfo.pcmBuffer` layout our existing PR #1181 driver already reads. Almost
every piece of our shipped PR #1181 plumbing — the per-frame
`tickAndDrain`, the s8 deinterleaved buffer reader, the FFmpeg→Opus
harness, the mel-fingerprint scaffold — stays unchanged. Our host-side
`ply_*` handler stack gets **deleted**, because the wasm now drives them
internally; this is a feature, not a regression (handlers are a faithful
sequencer port that we'd otherwise spend months matching to the reference).
**Recommendation: rebuild from ottohg + minor host-side trim, ~16–24 hours.**

Every other path (rebuild + write our own SoundMain, port to TS, swap to mGBA,
side-emulator, BGM rips, native addon) is materially more work, materially
higher risk, or sacrifices something we currently have (game-state reader,
input bindings, headless-Bun runtime). Detailed below.

## Paths Investigated

### Path A — Rebuild tripplyons/pokeemerald-wasm with audio enabled (DIY) — _don't_

We considered patching out the `#if WASM` stubs in
[`src/m4a.c:24`](https://github.com/tripplyons/pokeemerald-wasm/blob/ed25aa78/src/m4a.c#L24)
(the entire stub block), letting the real `#else` C engine compile, and
writing a TS `SoundMain` to handle the wasm-ld `--allow-undefined`
imports.

**Reality check on what's actually missing.** Inspecting
`/tmp/srcref/pokeemerald-wasm/src/m4a.c` and
`/tmp/srcref/pokeemerald/src/m4a_1.s` (1916 lines of Thumb/ARM asm):

- The real C engine (`m4a.c` `#else` branch, ~1300 LOC) is already in the
  source — just gated.
- The ARM-only symbols (`SoundMain`, `SoundMainRAM`, `umul3232H32`, plus 33
  `ply_*` jump-table entries) all live in `m4a_1.s`, which `wasm-ld` cannot
  consume.
- The song data lives in `data/sound_data.s` + `sound/songs/*.s` with GNU-as
  macros that LLVM's wasm integrated assembler rejects (`.set` redefinition,
  location-counter arithmetic, `.rept`/`.endm`).

So path A is not "delete one ifdef": it requires
(i) a C reimplementation of `m4a_1.s`,
(ii) a wasm-friendly translator for `sound_data.s`,
(iii) updated Makefile rules,
(iv) `--export=gSoundInfo` to expose the mixed buffer.

That is exactly what ottohg already wrote. Doing it ourselves would be
~3–5 weeks of low-level work duplicating their port; the only reason to take
this path is if ottohg's fork were unmaintained or broken — neither is true
(see Path A' below).

**Verdict:** Don't. Use ottohg.

### Path A' — Cherry-pick ottohg/pokeemerald-wasm into our vendored build (RECOMMENDED) — _winner_

**Source of truth.** [`ottohg/pokeemerald-wasm`](https://github.com/ottohg/pokeemerald-wasm),
default branch `master`, current HEAD `ee8b964` (2026-06-08). 14 audio-related
commits over two days starting at `9a251a2` (2026-06-07, "Add WASM audio: m4a
engine port + Web Audio bridge"), then six hardening commits, then BDPCM
compressed-sample decode, then envelope/CGB/reverb fixes. Author still active.

**What changed (mechanically):**

| File                                      | Change                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/m4a.c`                               | Skip the VBlank busy-wait in `SampleFreqSet` under WASM. Unchanged otherwise — the `#if WASM` stubs are still there, but now `m4a_wasm.c` provides real implementations of the asm-side symbols, so the real engine runs end-to-end.                                                                        |
| `src/m4a_wasm.c` (new, 49 KB / ~1500 LOC) | Full C port of `m4a_1.s`: `umul3232H32`, `MPlayMain`, every `ply_*` handler, `ply_note`, `WasmSoundMainRAM` (the DirectSound software mixer), Direct Sound channel allocation/envelope/voice-stealing, BDPCM decode, CGB channel synthesis (square 1/2, wave ch3, noise ch4), CGB square-1 frequency sweep. |
| `include/gba/m4a_internal.h`              | Add `NUM_MUSIC_PLAYERS=4`/`MAX_LINES=0` constants under `#if WASM` (replaces a linker-script trick that doesn't work in wasm-ld).                                                                                                                                                                           |
| `Makefile`                                | New rules `wasm_sound_data.py` → wasm object for `sound_data.s` and each `sound/songs/*.s`. New linker exports: `gSoundInfo`, `gWasmPcmL`, `gWasmPcmR`, `gSaveBlock1Ptr`, `gPlayerAvatar`, `gObjectEvents`, `VarGet`.                                                                                       |
| `tools/wasm_sound_data.py` (new, 22 KB)   | Macro-expanding assembler frontend translating GNU-as quirks (`.set` redef, location-counter arithmetic, `.rept`/`.endm`, `@` comments) into clang-wasm-assemblable GAS.                                                                                                                                    |
| `web/app.js`, `web/audio-worklet.js`      | Browser-side: reads `gSoundInfo.pcmBuffer` (s8 stereo at native ~13379 Hz), resamples to 48 kHz, posts L/R Float32 chunks to an AudioWorklet. We can **discard** this part — we don't need the worklet; we already have an FFmpeg → Opus pipeline.                                                          |

The browser-side `web/app.js`'s `feedAudio()` reads exactly what our existing
[`m4a-driver.ts:tickAndDrain`](packages/discord-plays-pokemon/packages/backend/src/emulator/audio/m4a-driver.ts)
already reads, byte-for-byte. The data contract is unchanged.

**Implementation plan (ours, ~16–24 hours):**

1. **Add ottohg as the wasm upstream** — replace the URL in our wasm build
   pipeline (currently `pokeemerald.com/build/wasm/pokeemerald.wasm`) with a
   built artifact from ottohg's `master` HEAD. Either:
   (a) commit the rebuilt `assets/pokeemerald.wasm`, with a `scripts/build-wasm.sh`
   that runs `make wasm` against a pinned ottohg SHA, or
   (b) add a Dagger task that builds it in CI from a pinned SHA.
   Option (a) matches what we already do (committed wasm asset). **~3 h.**

2. **Build the wasm locally once** — `clang` (LLVM 17+, both system or
   `/opt/homebrew/opt/llvm`), `wasm-ld`, `uv`/Python (for
   `tools/wasm_sound_data.py`). Verify reference build artifact matches the
   one published by ottohg. **~2 h.**

3. **Delete the host-side handler stack.** The wasm now drives `MPlayMain` and
   the entire `ply_*` jump table internally. Remove `src/emulator/audio/m4a-handlers-*.ts`
   (`basic`, `env`, `ext`, `flow`, `note`, `note-on`), `m4a-memory.ts`,
   `m4a-structs.ts`, and the corresponding `extras` plumbing in
   `audio/index.ts` and `bios.ts`. **~3 h.**

4. **Slim `m4a-driver.ts` to just the drain path.** Keep the
   `tickAndDrain` that reads `gSoundInfo.pcmBuffer` (s8 interleaved into LRLR);
   delete `initEngine` (the wasm boots audio on its own when the title screen
   starts BGM, but if we want deterministic frame-0 PCM we still want a small
   `initEngine` that calls the wasm's exported `m4aSoundInit`). **~2 h.**
   _Optional upgrade:_ switch the drain to `gWasmPcmL`/`gWasmPcmR` (Float32,
   no s8 quantisation, ~40 dB cleaner — see ottohg `65a85af`).
   That's a 30-minute follow-up once the s8 path is proven.

5. **Re-run the existing FFmpeg→Opus harness** (`scripts/audio-e2e.ts`) end
   to end against the new wasm. Confirm the mel-fingerprint test scaffold
   produces output that matches a recorded baseline from ottohg's deployed
   demo (their fork has a video on its README — capture audio from that).
   **~2 h.**

6. **Iterate on remaining wasm-side bugs.** ottohg's commit log warns of
   missing pieces at HEAD: full BDPCM decode landed at `bdb98ba`, CGB noise
   at `0d13835`, square-1 sweep at `b9adb32`, reverb feedback decay at
   `ee8b964`. The README still says "in-progress." Expect to file a few PRs
   upstream as we hit edge cases. **Budget 4–6 h of iteration.**

**What we keep, what we lose:**

- **Game-state reader (`symbols.ts`, `memory.ts`)**: keeps working unchanged.
  ottohg explicitly added `--export=gSaveBlock1Ptr --export=gPlayerAvatar
--export=gObjectEvents --export=VarGet` alongside `gSoundInfo`. Our
  `GAME_SYMBOL_NAMES` (`gSaveBlock1Ptr`, `gSaveBlock2Ptr`, `gPlayerParty`,
  `gPlayerPartyCount`, `gBattleResults`) need to survive — `gSaveBlock1Ptr`
  is already covered; we'll need to verify the other four are still
  `--export-all`'d (the original tripplyons Makefile uses `--export-all`; let
  me audit that line in ottohg's diff: yes, still `--export-all -o $@`).
  No work.
- **Input bindings (`bios.ts`, `KEYINPUT` writes in `emulator.ts:setKeys`)**:
  unchanged. The wasm's input model is the same.
- **Video pipeline (`renderer.ts`)**: unchanged. The framebuffer in
  VRAM-mapped memory is untouched by the audio changes.
- **Lose:** the entire host-side m4a TS reimplementation from PR #1181
  (handlers, memory accessors, struct offsets). ~3 KLOC deleted. The driver,
  drain, FFT/mel/chroma analysis, audio-e2e harness, fingerprint test
  scaffold survive — they were always pipeline-side concerns.

**Risk surface:**

- **ottohg's fork is six days old.** README admits "in-progress audio port."
  Bugs we'd hit are roughly proportional to how much of the music library we
  exercise. The fix-cadence has been ~3 fix-commits per day, so missing
  features are likely to land upstream before our scaffold matures. Mitigation:
  pin a SHA, file issues upstream, optionally maintain a local patch series
  in `scripts/build-wasm.sh`.
- **Build env**: `clang --target=wasm32-unknown-unknown` and `wasm-ld` are
  uncommon in CI images. We'd need either a homebrew-LLVM-on-macOS workflow
  for local builds or a `clang+wasm-ld+uv` Docker image for CI (an alpine
  `clang` image is ~150 MB). **Easy** — Dagger handles this.
- **Output size**: tripplyons's current wasm is 26 MB. Adding the song table
  - voicegroups + samples (BDPCM-compressed) inflates by roughly +6–10 MB
    based on ROM ratios. We commit it to `assets/`; manageable.
- **License**: pret/pokeemerald is unlicensed-but-tolerated decomp,
  tripplyons and ottohg inherit. Nothing changes for us.

**Verification path:**

- **Layer 1 (mixer runs):** boot the new wasm, observe non-zero bytes flowing
  out of `tickAndDrain()`. Sanity-check sample-rate global (`pcmFreq`) is
  ~13379 Hz.
- **Layer 2 (recognizable BGM):** boot, send the canned title-screen press
  sequence, capture 10 s of audio through `scripts/audio-e2e.ts`, listen with
  `afplay`. Title-screen Pokémon Emerald theme is well-known and
  audibly distinct.
- **Layer 3 (regression baseline):** record reference audio from ottohg's
  deployed demo (the README has a video). Compute its mel-fingerprint with
  our existing tooling and use it as the `audio-e2e.test.ts` fixture. Our
  output should match within the existing tolerance (the FFT/mel/chroma
  analysis is already in `src/emulator/audio/analysis.ts`).
- **Layer 4 (game state still works):** rerun
  `emulator-symbols.integration.test.ts` against the new wasm. If it passes,
  the data-segment symbols are still where we expect them.

### Path B — Swap to mGBA (or other real GBA emulator) — _not viable headlessly_

**The candidate.** `@thenick775/mgba-wasm` (npm, v2.4.1, last published
2 months ago) is the only actively-maintained GBA emulator wasm with a
JavaScript API. Source: [`thenick775/mgba`](https://github.com/thenick775/mgba)
branch `feature/wasm`, HEAD `be30a34` (2026-01-22). Powers
[gbajs3](https://github.com/thenick775/gbajs3).

**Why it doesn't work for our case:** mGBA's wasm build is fundamentally
browser-coupled. From
[`src/platform/wasm/main.c`](https://github.com/thenick775/mgba/blob/feature/wasm/src/platform/wasm/main.c):

- Links against SDL2 audio (`mSDLPauseAudio`, `mSDLDeinitAudio`).
- Uses Emscripten pthreads (`mCoreThread`,
  `emscripten_set_main_loop_timing`) and so requires SharedArrayBuffer with
  `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
require-corp`.
- Driven by `emscripten_set_main_loop` (no headless step-one-frame API).
- Most callbacks go through `MAIN_THREAD_EM_ASM` — needs the main thread to
  be a browser thread.
- Boot path expects a `canvas` parameter on the Module init.

Running this in Bun is theoretically possible (SAB and worker_threads exist),
but: SDL2 audio doesn't work, the main-loop model fights our explicit
60-Hz frame driver, the canvas dependency forces a node-canvas shim, and the
TS bindings (`mgba.d.ts`) don't expose a "drain one frame of PCM into a
buffer" call — audio is owned by SDL.

Fixing this means forking the mGBA wasm platform layer to:
(a) replace SDL audio with a `mCoreAudioBuffer` consumer that returns a PCM
slice per frame,
(b) replace `mCoreThread` with single-threaded synchronous frame stepping
(mGBA does have such a mode internally — `core->runFrame()` — but the
JS bindings don't expose it),
(c) replace the canvas video sink with a framebuffer pointer accessor,
(d) drop pthreads from the build so no SAB is needed.

That's a 4–6 week port project for someone fluent in mGBA's core API. Even
done, we lose our wasm-globals game-state reader: mGBA holds GBA EWRAM at
its own internal address inside the emulator core, so `symbols.ts` would
have to be rewritten against EWRAM offsets (which the decomp does provide,
but we lose name-based lookup and have to track offsets per ROM build).

**Verdict:** Not viable without a multi-week mGBA fork.

**Other GBA emulator wasms considered:**

- [`endrift/gbajs`](https://github.com/endrift/gbajs) — archived, no
  maintenance.
- [`andychase/gbajs2`](https://github.com/andychase/gbajs2) — pure JS, Web
  Audio coupled, no Node story.
- VBA-M / vba-wasm — no maintained npm presence.
- Beetle GBA / mednafen-wasm / RetroArch cores — exist as compiled libretro
  cores but require a libretro frontend wasm that doesn't run headlessly in
  Bun.

### Path C — Port the full m4a engine to TypeScript — _defeated by Path A'_

The TS port is exactly what we shipped in PR #1181: 47 handlers, drains,
fixture tests. The remaining piece would be a TS port of `SoundMain` (the
DirectSound software mixer, ~400 LOC of `m4a_1.s` translated to TS) plus the
CGB envelope step (already in C in `m4a.c`'s `#else` branch).

This is a 2–3 week project producing a TS engine that, by construction,
will sound slightly different from ottohg's because mixer fidelity comes from
hundreds of subtle GBA-hardware nits (PWM rate quantisation, VBlank-aligned
buffer flipping, CGB c15 envelope step, BDPCM decode rounding). agbplay
([`ipatix/agbplay`](https://github.com/ipatix/agbplay), C++) is the gold-
standard reference but it's a _player_ not an _engine_ — porting requires
mapping its decoupled-from-frame-loop model back onto the GBA's per-VBlank
mixer.

Given ottohg has already done the equivalent work _in the wasm where the
engine lives natively_, our TS port is the inferior approach: we'd run a
slightly-wrong mixer outside the wasm against state we read from the wasm,
with two synchronization surfaces to debug.

**Verdict:** Strictly dominated by A'. Don't pursue unless A' falls through.

### Path D — Hybrid sidecar emulator — _don't_

Run pokeemerald-wasm for video/state and a second emulator (mGBA, vba) for
audio. Both consume the same input stream. Sync drift between the C decomp
and an emulator running the actual `.gba` ROM is guaranteed within seconds:
RNG seeds diverge, save-block layouts differ, animations advance at
different rates due to non-deterministic IRQ timing. After a few minutes
the audio would describe a completely different game state than what's on
screen.

**Verdict:** Don't.

### Path E — Pre-rendered BGM triggered by game state — _fallback only_

Detect `currentMapMusic` from the wasm's exported globals and play matching
.ogg rips. Sources:

- [Khinsider — Pokemon Emerald gamerip](https://downloads.khinsider.com/game-soundtracks/album/pokemon-emerald-gameboy-advance-gamerip)
  (FLAC, ~267 MB total).
- [Internet Archive — Pokémon Ruby & Sapphire Super Music Collection](https://archive.org/details/pkmn-rse-soundtrack)
  (FLAC).
- [Zophar's Domain — GSF rips](https://www.zophar.net/music/gameboy-advance-gsf/pokemon-emerald).

**Effort to ship:** Cataloging the ~80 BGM tracks plus per-track loop
points takes ~6 h. Detecting current music ID requires reading the
`gMPlayInfo_BGM.songHeader` global through symbol resolution (we already
have similar plumbing). Cross-fading between tracks on map transitions:
maybe 4 h. Total: ~20 h to get music; no SFX (battle hits, menu blips,
cries) at all.

**What it misses:** SFX is roughly 50% of perceived audio life. A Pokémon
battle with music but no attack hits feels broken. Cries when a Pokémon
appears feel essential. So "music only" is a passable demo but not parity
with a real emulator.

**Verdict:** Only as a stopgap if A' has a 2–3 week blocker.

### Path F — Misc: native node addon, WASI sound tool, song player from wasm memory

- **Native addon (N-API) wrapping agbplay**: ~2 weeks, ships native binaries,
  defeats the "pure wasm + bun" runtime story, breaks our Linux container
  deploy story. Don't.
- **WASI sound-only tool**: same engineering as path A' (same C port) without
  the wasm-globals data-state win. Strictly worse than A'.
- **Hand-rolled song reader from wasm memory**: rebuild the m4a engine
  on top of the already-loaded song bytes by walking `MusicPlayerInfo`
  out-of-band. This _is_ essentially path C with a fancier name. Don't.

## Comparison Matrix

| Path                              | Effort (h) | Risk                  | Blast radius (host code)     | Time-to-audible | Recommended? |
| --------------------------------- | ---------: | --------------------- | ---------------------------- | --------------- | ------------ |
| A — DIY rebuild + own SoundMain   |    120–200 | High (mixer fidelity) | Same as A'                   | 4–6 weeks       | No           |
| **A' — ottohg + minor host trim** |  **16–24** | **Low–Med**           | **Delete 3 KLOC handlers**   | **2–3 days**    | **Yes**      |
| B — Swap to mGBA wasm             |    160–240 | High (mGBA port)      | Rewrite reader + driver      | 5–8 weeks       | No           |
| C — TS port (SoundMain + tune)    |     80–120 | Med (mixer fidelity)  | Add ~500 LOC                 | 3–4 weeks       | No           |
| D — Sidecar emulator              |      60–80 | Critical (sync drift) | Add 1 KLOC sync code         | 2–3 weeks       | No           |
| E — Pre-rendered BGM              |      16–24 | Low (no SFX)          | Add ~500 LOC + 300 MB assets | 3 days          | Fallback     |
| F.1 — Native addon                |      60–80 | High (deploy story)   | Add N-API binding            | 2–3 weeks       | No           |
| F.2 — Hand-rolled song reader     |     80–120 | High (fidelity)       | Add 2 KLOC                   | 3–4 weeks       | No           |

## Cited Sources (with SHAs)

- [`tripplyons/pokeemerald-wasm`](https://github.com/tripplyons/pokeemerald-wasm)
  default-branch HEAD `ed25aa78` (2026-05-29) — current upstream
- [`tripplyons/pokeemerald-wasm#2 "Fork with audio"`](https://github.com/tripplyons/pokeemerald-wasm/issues/2)
  (open, 2026-06-08) — confirms upstream tripplyons accepts PRs
- **[`ottohg/pokeemerald-wasm`](https://github.com/ottohg/pokeemerald-wasm)
  HEAD `ee8b964` (2026-06-08)** — the recommended source
- Audio commits, in landing order:
  - `9a251a2` — "Add WASM audio: m4a engine port + Web Audio bridge"
  - `0d13835` — "Add WASM CGB noise channel (ch4) synthesis"
  - `bdb98ba` — "Decode WASM BDPCM compressed and reversed samples"
  - `b9adb32` — "Add WASM CGB square-1 frequency sweep"
  - `1f32504` — "Fix WASM MPlayMain fade handling (inverted condition)"
  - `64c6d68` / `6158084` — "Fix WASM_SONG_NAMES=all" / "Default WASM build to all songs + SE"
  - `4a5f07f` — "Fix WASM audio accuracy: loop flag, reverb, CGB ch3 volume, voice stealing"
  - `81a552a` — "Fix WASM keysplit pitch: use track->key not sub-voice root key"
  - `efb66e3` — "Fix WASM DS envelope: apply attack step on the SF_START frame"
  - `84a9c68` — "Fix WASM CGB volume: remove spurious x8 factor from amplitude formula"
  - `db0f12f` — "Fix WASM audio crackling: partial drain on worklet underrun"
  - `a72f9df` / `65a85af` — "Fix WASM audio hiss: bypass s8 quantisation / float accumulator path"
  - `ee8b964` — "Fix WASM audio ring: decay reverb feedback to true silence"
- [`pret/pokeemerald`](https://github.com/pret/pokeemerald) — original
  decomp; provides `src/m4a_1.s` (the asm ottohg ported to C in
  `src/m4a_wasm.c`)
- [`thenick775/mgba` branch `feature/wasm`](https://github.com/thenick775/mgba/tree/feature/wasm)
  HEAD `be30a34` (2026-01-22) — mGBA fork that ships
  [`@thenick775/mgba-wasm` v2.4.1](https://www.npmjs.com/package/@thenick775/mgba-wasm).
  Browser-only, not viable headlessly.
- [`mgba-emu/mgba`](https://github.com/mgba-emu/mgba) — upstream mGBA, last
  push 2026-06-11. Not packaged for browser/Node.
- [`thenick775/gbajs3`](https://github.com/thenick775/gbajs3) — production
  reference of mGBA-wasm integration. Confirms browser-only model.
- [`ipatix/agbplay`](https://github.com/ipatix/agbplay) — reference C++
  implementation of the m4a engine if we ever do path C.
- [`endrift/gbajs`](https://github.com/endrift/gbajs) — archived pure-JS GBA
  emulator (not viable).
- [`andychase/gbajs2`](https://github.com/andychase/gbajs2) — derived JS
  emulator, browser-coupled audio (not viable).
- [Khinsider — Pokemon Emerald (GBA) gamerip](https://downloads.khinsider.com/game-soundtracks/album/pokemon-emerald-gameboy-advance-gamerip)
  — BGM rip source for path E.
- [Internet Archive — Pokémon Ruby & Sapphire Super Music Collection](https://archive.org/details/pkmn-rse-soundtrack)
  — alt BGM rip source for path E.

## Session Log — 2026-06-13

### Done

- Cataloged every credible audio path; identified `ottohg/pokeemerald-wasm` as
  the in-tree m4a-engine port that the discord-plays-pokemon backend can
  consume with minimal host changes.
- Documented effort/risk per path with file-level scope estimates.

### Remaining

- Execute path A': swap our `assets/pokeemerald.wasm` source from
  `pokeemerald.com/build/wasm/pokeemerald.wasm` to a build of ottohg's repo
  at a pinned SHA (start with `ee8b964`); trim
  `src/emulator/audio/m4a-handlers-*.ts` + `m4a-memory.ts` +
  `m4a-structs.ts` once the wasm-side handlers are confirmed to run; verify
  `tickAndDrain` against the new buffer; rerun the FFmpeg→Opus harness.
- Add a `scripts/build-wasm.sh` (or Dagger task) that clones ottohg at a
  pinned SHA and runs `make wasm`.
- Decide between s8 drain (current) and Float32 drain (ottohg `gWasmPcmL/R`)
  — pick Float32 unless it introduces other instability.

### Caveats

- ottohg's fork is six days old and self-described as "in-progress." Pin a
  SHA and treat upstream as live during the integration. Expect to file
  follow-up PRs upstream as we hit missing features.
- The wasm build requires `clang --target=wasm32-unknown-unknown` + `wasm-ld`
  - `uv`/Python. CI image will need these.
- The committed wasm will grow by roughly +6–10 MB (song table + voicegroups
  - samples).
- `--export-all` in tripplyons's link line was unchanged by ottohg, so our
  game-state-reader globals (`gSaveBlock1Ptr`, `gSaveBlock2Ptr`,
  `gPlayerParty`, `gPlayerPartyCount`, `gBattleResults`) should keep
  exporting. Verify explicitly during integration.
- The PR #1181 host-side handler suite is being deleted, not orphaned —
  delete with confidence; the wasm now owns this logic. Driver/drain/FFT
  analysis/harness/fixture scaffold survive.
