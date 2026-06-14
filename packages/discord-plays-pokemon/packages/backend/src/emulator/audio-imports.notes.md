# Audio Imports — Upstream Research Notes (TEMP)

**Status: Working notes for Phase 2 of the audio-host port. Delete at end of Phase 2.**

## Source of truth

- **Upstream repo:** https://github.com/tripplyons/pokeemerald-wasm
- **Pinned commit:** `ed25aa7c5ae9c3c338cc9aa57c7150fc33255ad3` (master @ 2026-06-12)
- **Canonical JS file:** [`web/app.js`](https://raw.githubusercontent.com/tripplyons/pokeemerald-wasm/ed25aa7c5ae9c3c338cc9aa57c7150fc33255ad3/web/app.js) (869 lines, 26 KB, plain hand-written ES module — NOT minified, NOT emscripten-generated)
- **HTML host:** [`web/index.html`](https://raw.githubusercontent.com/tripplyons/pokeemerald-wasm/ed25aa7c5ae9c3c338cc9aa57c7150fc33255ad3/web/index.html) — confirms there is no `<audio>` element, no Web Audio API plumbing, only `<canvas>` and `<button>` controls.
- **Wasm under inspection:** `https://pokeemerald.com/build/wasm/pokeemerald.wasm` (12 MB, downloaded 2026-06-13). I enumerated its `WebAssembly.Module.imports()` and `.exports()` directly in Bun to verify symbol presence.

This is the same source `bios.ts` was ported from (see `bios.ts:1-4` header), so the audio import names live in the same `importsFor(module)` switch.

---

## TL;DR — Upstream Has NO Audio Implementation

**Every single audio import is a silent no-op returning `0`** via the fall-through `default` case in `importsFor()`. There is no:

- audio-import switch case anywhere in `web/app.js`
- call to `m4aSoundMain`, `SoundMain`, `SoundMainBTM`, or any other audio export from the JS host
- read of `SoundMainRAM_Buffer` for playback
- `AudioContext` / `OfflineAudioContext` / `<audio>` / `requestAnimationFrame`-driven audio tick
- mention of the strings `audio`, `sound`, `m4a`, `ply_`, `PokemonCry`, `SampleFreq`, `TrackStop`, `FadeOut`, or `gMPlay` anywhere in `web/app.js` (grep result: empty)

`grep -in -E "ply_|SampleFreq|TrackStop|FadeOut|PokemonCry|SoundMain|m4a|AudioContext|audio|sound|gMPlay|webaudio" web/app.js` → **zero matches**.

The upstream site plays the game **silently**. The wasm imports exist (the linker can't omit them), but the host hands the engine no-op stubs and never ticks the engine.

So: there is no upstream reference for actual audio-engine behavior. The host port can match upstream verbatim (cheap, silent, drops sound effects + music) or invest in a real driver that calls `m4aSoundMain` and reads `SoundMainRAM_Buffer`. Discussed at the bottom under "Going beyond upstream".

---

## The verbatim upstream impl for ALL audio imports

`web/app.js:633-655` — the **entire** `importsFor()` function. Audio imports fall through to `default: return 0;`.

```js
function importsFor(module) {
  const env = {};
  for (const item of WebAssembly.Module.imports(module)) {
    if (item.kind !== "function") continue;
    env[item.name] = (...args) => {
      switch (item.name) {
        case "CpuSet":
          return copy(
            args[0],
            args[1],
            args[2] & 0x1fffff,
            (args[2] >>> 26) & 1 ? 4 : 2,
            (args[2] >>> 24) & 1,
          );
        case "CpuFastSet":
          return copy(
            args[0],
            args[1],
            args[2] & 0x1fffff,
            4,
            (args[2] >>> 24) & 1,
          );
        case "LZ77UnCompWram":
        case "LZ77UnCompVram":
          return lz77(args[0], args[1]);
        case "RLUnCompWram":
        case "RLUnCompVram":
          return rl(args[0], args[1]);
        case "BgAffineSet":
          return bgAffineSet(args[0], args[1], args[2]);
        case "ObjAffineSet":
          return objAffineSet(args[0], args[1], args[2], args[3]);
        case "Div":
          return args[1] ? (args[0] / args[1]) | 0 : 0;
        case "Sqrt":
          return Math.sqrt(args[0]) | 0;
        case "strcmp":
          return readCString(args[0]).localeCompare(readCString(args[1]));
        default:
          return 0;
      }
    };
  }
  return { env };
}
```

That `default: return 0;` is what every single audio symbol below hits. Below each name I note the GBA-m4a meaning for context; **the upstream JS impl is literally `() => 0` for all of them**.

### Track-command opcodes (called from m4a "song engine" runtime)

Every `ply_*` symbol is one of the GBA m4a track-event opcodes the C runtime would normally invoke per-channel-tick. Returning `0` and doing nothing means the engine's per-track state never advances on these events; songs stay silenced (no notes start, no envelopes update). Reference: `pret/pokeemerald` `sound/m4a/m4a.s` jump table — the C runtime walks the per-channel track byte stream and dispatches to one of these handlers per opcode.

| Import name   | GBA opcode meaning                                     |
| ------------- | ------------------------------------------------------ |
| `ply_fine`    | end-of-track marker (stop the channel)                 |
| `ply_goto`    | absolute jump to a track offset                        |
| `ply_patt`    | call into a sub-pattern (push return)                  |
| `ply_pend`    | return from sub-pattern                                |
| `ply_rept`    | repeat-N counter                                       |
| `ply_prio`    | set channel priority                                   |
| `ply_tempo`   | set BPM (typically scales VBLANK ticks)                |
| `ply_keysh`   | key-shift (transpose)                                  |
| `ply_voice`   | switch instrument (Voice table entry)                  |
| `ply_vol`     | channel volume                                         |
| `ply_pan`     | stereo pan                                             |
| `ply_bend`    | pitch-bend value                                       |
| `ply_bendr`   | pitch-bend range                                       |
| `ply_lfos`    | LFO speed                                              |
| `ply_lfodl`   | LFO delay                                              |
| `ply_mod`     | modulation depth                                       |
| `ply_modt`    | modulation type (pitch / vol / pan)                    |
| `ply_tune`    | per-channel fine tuning                                |
| `ply_port`    | portamento (slide)                                     |
| `ply_endtie`  | terminate a tied note                                  |
| `ply_xxx`     | extended-op prefix (Xcmd marker)                       |
| `ply_xwave`   | direct-sound waveform pointer                          |
| `ply_xtype`   | wave type                                              |
| `ply_xatta`   | ADSR attack                                            |
| `ply_xdeca`   | ADSR decay                                             |
| `ply_xsust`   | ADSR sustain                                           |
| `ply_xrele`   | ADSR release                                           |
| `ply_xiecv`   | echo volume                                            |
| `ply_xiecl`   | echo length                                            |
| `ply_xleng`   | note length                                            |
| `ply_xswee`   | pitch sweep                                            |
| `ply_xwait`   | wait/delay                                             |
| `ply_xcmd_0D` | extended cmd 0x0D (reserved, often direct param write) |

**Upstream JS impl for ALL of the above:** `() => 0`. No state machine, no buffer write.

### Engine-control imports

| Import name             | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `SampleFreqSet`         | set the m4a engine's PCM mix rate (e.g. 13379 / 15768 / 18157 Hz) |
| `TrackStop`             | stop a specific track on a MusicPlayer                            |
| `FadeOutBody`           | run one tick of a fade envelope                                   |
| `SetPokemonCryVolume`   | per-cry volume override                                           |
| `SetPokemonCryPanpot`   | per-cry stereo pan                                                |
| `SetPokemonCryPitch`    | per-cry pitch                                                     |
| `SetPokemonCryLength`   | per-cry note length                                               |
| `SetPokemonCryProgress` | cry-playback progress                                             |
| `SetPokemonCryRelease`  | cry-release time                                                  |
| `SetPokemonCryChorus`   | cry chorus / detune                                               |
| `SetPokemonCryTone`     | cry tone / waveform pick                                          |
| `SetPokemonCryStereo`   | stereo on/off for cry                                             |

**Upstream JS impl for ALL of the above:** `() => 0`.

### Bonus audio imports the wasm actually has (not in the task list)

Verified by `WebAssembly.Module.imports(module)`:

- `TrkVolPitSet` — recompute combined volume+pitch on a track (m4a internal helper)
- `IsPokemonCryPlaying` — query whether a cry channel is still active

These are also `() => 0` upstream. Worth porting **`IsPokemonCryPlaying`** even in a silent build because game code branches on it (e.g. waiting for a cry to finish before advancing a textbox could spin forever if it's always 0 — though in practice the cry-task code has timeout fallbacks; verify in our headless run). Default `0` likely works but flag it.

### Full upstream wasm import list (69 functions, all `kind: "function"`)

For reference — what `bios.ts` already covers vs. what audio needs:

```
ArcTan2                  BgAffineSet              CpuFastSet
CpuSet                   Div                      FadeOutBody              <- audio
GameCubeMultiBoot_*      IsPokemonCryPlaying      <- audio
LZ77UnCompVram           LZ77UnCompWram           MultiBoot
ObjAffineSet             RLUnCompVram             RLUnCompWram
RealClearChain           RegisterRamReset         SampleFreqSet            <- audio
SetPokemonCryChorus      SetPokemonCryLength      SetPokemonCryPanpot      <- audio
SetPokemonCryPitch       SetPokemonCryProgress    SetPokemonCryRelease     <- audio
SetPokemonCryStereo      SetPokemonCryTone        SetPokemonCryVolume      <- audio
SoftReset                Sqrt                     TrackStop                <- audio
TrkVolPitSet             VBlankIntrWait
ply_bend ply_bendr ply_endtie ply_fine ply_goto ply_keysh                  <- audio
ply_lfodl ply_lfos ply_mod ply_modt ply_pan ply_patt                       <- audio
ply_pend ply_port ply_prio ply_rept ply_tempo ply_tune                     <- audio
ply_voice ply_vol ply_xatta ply_xcmd_0D ply_xdeca ply_xiecl                <- audio
ply_xiecv ply_xleng ply_xrele ply_xswee ply_xsust ply_xtype                <- audio
ply_xwait ply_xwave ply_xxx                                                <- audio
strcmp
```

`bios.ts` currently handles: `CpuSet`, `CpuFastSet`, `LZ77UnComp*`, `RLUnComp*`, `BgAffineSet`, `ObjAffineSet`, `Div`, `Sqrt`, `strcmp`. Other still-unhandled (non-audio) names that hit `default: return 0;` upstream and may matter for headless: `ArcTan2`, `GameCubeMultiBoot_*`, `MultiBoot`, `RealClearChain`, `RegisterRamReset`, `SoftReset`, `VBlankIntrWait`. Not in scope for this audio phase, but flagging.

---

## Per-frame driving code (verbatim)

`web/app.js:759-769` — the **only** per-frame engine call:

```js
function runFrames(frameCount, keyMask = 0) {
  for (let i = 0; i < frameCount; i++) {
    if (keyMask) u16[KEYINPUT >> 1] = KEY_MASK ^ keyMask;
    else writeKeys();
    instance.exports.WasmRunFrame();
    currentFrame++;
    stepPendingPresses();
  }
  u16[KEYINPUT >> 1] = KEY_MASK;
  saveFlashIfChanged();
}
```

The wrapping animation loop (`web/app.js:852-864`):

```js
function tick(now) {
  try {
    const elapsedMs = Math.min(now - lastTick, 100);
    lastTick = now;
    const frames = runFramesForTick(elapsedMs);
    render();
    updateFps(frames);
    requestAnimationFrame(tick);
  } catch (error) {
    console.error(error);
    statusEl.textContent = error.stack || String(error);
  }
}
```

**`WasmRunFrame()` is the only exported function called per frame.** `m4aSoundMain`, `SoundMain`, `SoundMainBTM`, and `m4aSoundVSync` are **never** called from JS upstream. They're inside the wasm export list but the host never invokes them.

(Boot also calls `instance.exports.AgbMain()` once — `web/app.js:731` — which is the C entrypoint that internally calls `SoundInit` and sets up the engine state. Whether the engine progresses thereafter depends on whether `WasmRunFrame` internally ticks the m4a state machine — see below.)

---

## How does the wasm "run a frame"?

I don't have C source visibility from the wasm alone, but the export table tells us:

- `WasmRunFrame` is a **custom wrapper** added by tripplyons' fork — it's not in vanilla pokeemerald. From the surrounding code (Read of `bios.ts` analogue and the lack of a separate audio tick), this wrapper most likely runs one VBlank iteration of the GBA main loop, which in pokeemerald would normally call `m4aSoundMain()` from `VBlank` (see `pret/pokeemerald` `agb_flash/agb_flash.c` / `main.c`).
- BUT — because every `ply_*` import returns 0, the engine's per-track state never advances. So even if `WasmRunFrame` does internally tick `m4aSoundMain`, the song data is never executed; the mixer would mix silence.
- This means **`SoundMainRAM_Buffer` will fill with silence** (zeros, or DC offset) regardless of whether `WasmRunFrame` calls the mixer or not, as long as upstream's no-op `ply_*` strategy is kept.

So the upstream design is consistent: stubbed-out track commands + (probably) idle mixer → silent buffer → JS never reads it → silent emulator.

---

## PCM buffer details — no upstream reader, but here's the spec

Upstream **does not read `SoundMainRAM_Buffer`** anywhere. There is no `Web Audio` shim to derive a format from.

For the format reference, what `pret/pokeemerald` `sound/m4a/m4a.h` and `m4a_2.s` say about the GBA m4a engine:

- **Sample format:** signed 8-bit (s8) PCM. The engine mixes into an `int8_t` ring buffer; the GBA's Direct Sound DMA hardware reads it as s8 and writes to FIFO_A/FIFO_B. NOT s16.
- **Buffer layout:** double-buffered. `SoundMainRAM_Buffer` is split into two halves; one half is DMA'd while the other is written by `SoundMain`. The boundary symbol is `gSoundInfo` (see exports), which holds `pcmBuffer` pointers and `pcmFreq` / `pcmSamplesPerVBlank`.
- **Sample rate:** configurable via `m4aSoundMode` / `SampleFreqSet`. Pokemon Emerald defaults to one of the m4a "freq table" entries — typically **`MAX_DIRECTSOUND_FREQ` = 18157 Hz** (matches `15768` / `13379` / `18157` choices in vanilla `m4a.h`). Default for E is `13379 Hz` IIRC; would need to read `gSoundInfo.pcmFreq` at runtime to be sure.
- **Channel count:** 2 (stereo) — left half then right half (or interleaved s8, check `gSoundInfo` layout via offsets).
- **Frame size (samples per VBlank tick):** `pcmSamplesPerVBlank` in `gSoundInfo`, typically ~224 samples per channel at 13379 Hz × ~16.67 ms.

**Read strategy if we ever want real audio:** Each VBlank tick (i.e. each `WasmRunFrame` call), call `instance.exports.m4aSoundMain()` (probably already done internally), then read `gSoundInfo.pcmBuffer` (the half about to be DMA'd) at the current frame offset, copy out `pcmSamplesPerVBlank` × 2 channels of s8, and stream to Discord's Opus encoder. The `gSoundInfo` global address comes from `instance.exports.gSoundInfo.value` (it's a `WebAssembly.Global` in exports per `bios.ts` precedent — `instance.exports.gSaveBlock1Ptr.value` pattern at `web/app.js:794`).

**Concrete next research step** before implementing real audio: dump `gSoundInfo` struct offsets by reading the field via wasm memory and cross-referencing `pret/pokeemerald` `include/gba/m4a_internal.h` `struct SoundInfo`.

---

## Browser-only deps used by upstream

These appear in `web/app.js` but **none are touched by audio code** (audio code doesn't exist). Listing for completeness since we may need to stub these for any code we copy verbatim from the file:

| API                                                                    | Used at                                     | Headless replacement                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `performance.now()`                                                    | FPS counter, save throttle, frame budgeting | `Bun.nanoseconds() / 1e6` or `performance.now()` (works in Bun)                 |
| `requestAnimationFrame`                                                | `tick` loop                                 | Manual loop driven by our renderer cadence (already used elsewhere in our host) |
| `localStorage` (`SAVE_STORAGE_KEY`)                                    | Flash save persistence                      | File-backed save (already handled in our host)                                  |
| `document.querySelector`, `canvas`, `ctx.putImageData`, `image.data`   | Screen rendering                            | Our `renderer.ts` already handles this for headless                             |
| `window` event listeners (keydown/keyup/beforeunload/visibilitychange) | Input + save flush                          | Discord command sink (already handled)                                          |
| `btoa` / `atob`                                                        | Save base64                                 | `Buffer.from(x, 'base64')`                                                      |
| `canvas.toDataURL`                                                     | Automation screenshot                       | PNG encoding via our `png.ts`                                                   |

**Audio-specific browser deps required:** **none** (upstream doesn't use any). If we add real audio in our host, we'd need an Opus encoder for Discord — already in the host via `discord-video-stream`. No Web Audio API shim is needed because we drive the engine via direct wasm calls + buffer reads, not via `AudioContext`.

---

## Imports we couldn't find / confirmed no-ops

**All 33 `ply_*` + `SampleFreqSet` + `TrackStop` + `FadeOutBody` + all 9 `SetPokemonCry*` are confirmed no-ops returning `0` upstream.** There is no JS impl to "extract" — the implementations literally do not exist in upstream. This was verified two ways:

1. Read every line of `web/app.js` (869 lines, 26 KB, full file).
2. `grep -E 'ply_|SampleFreq|TrackStop|FadeOut|PokemonCry|SoundMain|m4a|AudioContext|audio|sound|gMPlay|webaudio' web/app.js` → 0 matches.

No alternate canonical JS file exists in upstream's `web/` directory (only `app.js` + `index.html` + `server.mjs` + `style.css`; verified via `gh api repos/tripplyons/pokeemerald-wasm/contents/web`). `server.mjs` is just a Wrangler/Cloudflare static server; it serves the wasm + JS as plain files.

---

## Going beyond upstream (if we want real audio)

We have two paths:

### Path A — Match upstream verbatim (silent, fast, low-risk)

Port the 33+ audio imports as `() => 0`. Drop `m4aSoundMain` / `SoundMainRAM_Buffer` entirely. The engine still goes through the motions internally but produces no audible output. Game code that polls `IsPokemonCryPlaying` will see `0`; verify the cry-wait task in `wild-encounter`/`battle-anim` code has a timeout that avoids deadlock (the GBA game does, but worth a headless run).

**Effort:** minutes. Just an `audio.ts` analog to `bios.ts` with a fat switch returning 0.

### Path B — Real audio (mirror what a real cart would do)

We don't need to port `ply_*` to JS — those are called **from inside the wasm engine itself** through the import table, and the m4a runtime relies on them executing real C logic to advance its state. Since the C source for the runtime is compiled INTO the wasm under the `m4a*` exports (`m4aSoundMain` etc.), but the `ply_*` opcodes appear to be **imports** in this build (probably because tripplyons' Makefile compiles them out of the assembly source and expects the host to provide them), the only correct path is to **port the GBA m4a track-command handlers from `pret/pokeemerald` `sound/m4a/m4a_2.s` to JS**, one per opcode. That's a substantial port.

The cheaper alternative: rebuild the wasm with the `ply_*` handlers compiled in (they're inline asm in `pret/pokeemerald` — emscripten can include them as C via the `agb_flash`/`m4a` modules). Out of scope for our host but worth flagging for tripplyons.

**Best ROI for "we want some audio" with low effort:** stub `ply_*` to 0 (silent BGM) AND port just the `SetPokemonCry*` family + `IsPokemonCryPlaying` so cries work via a small sample-table lookup. The Pokémon cry data is in ROM at `gCryTable`. But this is a Phase 3+ conversation.

**Recommendation for Phase 2:** Path A. Verbatim upstream parity → silent emulator, no functional regressions vs. the live site. Document Path B as a future task.

---

## Bun verification snippet (reproducible)

```bash
curl -sL https://pokeemerald.com/build/wasm/pokeemerald.wasm -o pokeemerald.wasm
bun -e '
  const wasm = await Bun.file("pokeemerald.wasm").arrayBuffer();
  const mod = await WebAssembly.compile(wasm);
  const audioImports = WebAssembly.Module.imports(mod)
    .filter(i => i.kind === "function")
    .filter(i => /^ply_|^Set|^SampleFreq|^TrackStop|^FadeOut|^IsPokemonCry|^TrkVolPit/.test(i.name))
    .map(i => i.name).sort();
  console.log(audioImports.length, "audio imports:", audioImports);
'
```

Count expected: ~47 (33 `ply_*` + `SampleFreqSet` + `TrackStop` + `FadeOutBody` + 9 `SetPokemonCry*` + `TrkVolPitSet` + `IsPokemonCryPlaying`).
