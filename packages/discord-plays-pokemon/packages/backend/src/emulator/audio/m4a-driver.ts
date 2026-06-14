// Per-frame audio driver: ticks the wasm-side m4a mixer (`m4aSoundMain`) and
// drains the resulting PCM out of `SoundMainRAM_Buffer`.
//
// PCM layout (from `pret/pokeemerald` `include/gba/m4a_internal.h`):
//   - `gSoundInfo.pcmBuffer` is `s8[PCM_DMA_BUF_SIZE * 2]` (3168 bytes).
//   - Stereo, deinterleaved: right channel at offset 0, left channel at
//     offset `PCM_DMA_BUF_SIZE` (1584).
//   - The buffer is double-buffered. `gSoundInfo.pcmDmaCounter` cycles between
//     two halves on every VBlank; the mixer writes into the half NOT currently
//     being DMA'd.
//   - `gSoundInfo.pcmSamplesPerVBlank` is the per-channel sample count.
//   - `gSoundInfo.pcmFreq` is the integer sample rate (e.g. 13379 Hz).

import type { M4aMemory } from "./m4a-memory.ts";
import { sampleFreqSet } from "./m4a-handlers-ext.ts";
import { PCM_DMA_BUF_SIZE, SI } from "./m4a-structs.ts";

export type DrainResult = {
  /** Interleaved s8 stereo PCM, ready for ffmpeg `-f s8 -ac 2`. */
  pcm: Buffer;
  /** Native sample rate this PCM was produced at. */
  freqHz: number;
  /** Number of stereo frames in `pcm` (== samplesPerVBlank). */
  frames: number;
};

export type M4aDriver = {
  /** Bind the wasm exports we need; call once after instantiation. */
  bindExports: (exports: WebAssembly.Exports) => void;
  /** Linear-memory address of `gSoundInfo`. Valid after `bindExports`. Returns
   * 0 before binding so callers can detect that case. */
  gSoundInfoAddr: () => number;
  /** Force-initialise the wasm-side audio engine by calling its exported
   * `SoundInit` + `m4aSoundMode` (with the Emerald-default 13379 Hz mode).
   * The wasm's natural boot path does NOT do this — the game starts audio
   * only when transitioning to a music-playing screen — so callers that want
   * deterministic PCM from the first frame should invoke this once after
   * `bindExports`. Idempotent. */
  initEngine: () => void;
  /** Run one mixer tick (call after `WasmRunFrame`) and return one frame of
   * PCM. Returns null if the engine has not produced a valid SoundInfo yet
   * (e.g. before `SoundInit` runs during boot). */
  tickAndDrain: () => DrainResult | null;
};

function requireFunction(
  exports: WebAssembly.Exports,
  name: string,
): () => void {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(
      `wasm module is missing required audio export: ${name}`,
    );
  }
  return () => {
    Reflect.apply(value, undefined, []);
  };
}

function readGlobalNumber(exports: WebAssembly.Exports, name: string): number {
  const value = exports[name];
  if (!(value instanceof WebAssembly.Global)) {
    throw new TypeError(
      `wasm module is missing required audio global export: ${name}`,
    );
  }
  // WebAssembly.Global.value is typed as `any` (it can be number for i32/f32/
  // f64, bigint for i64, or externref). Narrow through unknown so the result
  // is safely typed without a `as` assertion.
  const raw: unknown = value.value;
  if (typeof raw !== "number") {
    throw new TypeError(`audio global ${name} is not a number-valued global`);
  }
  return raw;
}

function requireFunctionWithArg(
  exports: WebAssembly.Exports,
  name: string,
): (arg: number) => void {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(
      `wasm module is missing required audio export: ${name}`,
    );
  }
  return (arg) => {
    Reflect.apply(value, undefined, [arg]);
  };
}

export function createM4aDriver(mem: M4aMemory): M4aDriver {
  let m4aSoundMain: (() => void) | undefined;
  let soundInit: ((arg: number) => void) | undefined;
  let m4aSoundMode: ((arg: number) => void) | undefined;
  let gSoundInfoAddr = 0;

  function bindExports(exports: WebAssembly.Exports): void {
    m4aSoundMain = requireFunction(exports, "m4aSoundMain");
    soundInit = requireFunctionWithArg(exports, "SoundInit");
    m4aSoundMode = requireFunctionWithArg(exports, "m4aSoundMode");
    gSoundInfoAddr = readGlobalNumber(exports, "gSoundInfo");
  }

  // pokeemerald's m4aSoundInit() calls m4aSoundMode with the full mode word
  // covering reverb (SET bit + value 0x50), maxChans 8, masterVolume 15
  // (the loudest setting), and freq index 4 (13379 Hz). Calling with just
  // FREQ_13379 leaves maxChans/masterVolume/reverb at 0, which silences the
  // mixer regardless of channel state. See m4a_internal.h:11-37 for the
  // SOUND_MODE_* bit layout.
  const SOUND_MODE_REVERB_SET = 0x80;
  const SOUND_MODE_REVERB_VAL_DEFAULT = 0x50;
  const SOUND_MODE_MAXCHN_8 = 8 << 8;
  const SOUND_MODE_MASVOL_15 = 15 << 12;
  const SOUND_MODE_FREQ_13379 = 4 << 16;
  const EMERALD_SOUND_MODE =
    SOUND_MODE_REVERB_SET |
    SOUND_MODE_REVERB_VAL_DEFAULT |
    SOUND_MODE_MAXCHN_8 |
    SOUND_MODE_MASVOL_15 |
    SOUND_MODE_FREQ_13379;

  function initEngine(): void {
    if (soundInit === undefined || m4aSoundMode === undefined) {
      throw new Error("initEngine called before bindExports");
    }
    // SoundInit stamps `ident` but doesn't populate maxChans / masterVolume /
    // pcmFreq / pcmSamplesPerVBlank — those come from m4aSoundMode.
    // m4aSoundMode in the wasm appears to write its updates through an
    // internal SOUND_INFO_PTR alias that's invisible to our handler, so we
    // also write the freq fields directly via sampleFreqSet AND mirror
    // m4aSoundMode's other writes (maxChans, masterVolume, reverb,
    // pcmDmaPeriod) directly so the driver-visible struct ends up correct.
    soundInit(gSoundInfoAddr);
    m4aSoundMode(EMERALD_SOUND_MODE);
    sampleFreqSet(mem, gSoundInfoAddr, 4);
    mem.writeU8(gSoundInfoAddr, SI.maxChans, 8);
    mem.writeU8(gSoundInfoAddr, SI.masterVolume, 15);
    mem.writeU8(gSoundInfoAddr, SI.reverb, SOUND_MODE_REVERB_VAL_DEFAULT);
    mem.writeU8(gSoundInfoAddr, SI.pcmDmaPeriod, 7);
  }

  function tickAndDrain(): DrainResult | null {
    if (m4aSoundMain === undefined) return null;
    m4aSoundMain();

    const freqHz = mem.s32(gSoundInfoAddr, SI.pcmFreq);
    const samplesPerVBlank = mem.s32(gSoundInfoAddr, SI.pcmSamplesPerVBlank);
    if (freqHz <= 0 || samplesPerVBlank <= 0) return null;

    // pcmDmaCounter convention: the wasm's m4aSoundMain increments the
    // counter internally before writing, so by the time it returns the
    // counter already points at the half it just wrote. We therefore read
    // pcmDmaCounter post-call and use it directly as the freshly-written
    // half index. (On real GBA hardware the DMA consumes the counter-indexed
    // half and the mixer writes the other; the wasm emulates this by
    // flipping the counter itself before mixing.)
    const dmaCounter = mem.u8(gSoundInfoAddr, SI.pcmDmaCounter);
    const halfOffset = (dmaCounter & 1) === 0 ? 0 : samplesPerVBlank;

    const bufBase = gSoundInfoAddr + SI.pcmBuffer;
    const right = mem.slice(bufBase, halfOffset, samplesPerVBlank);
    const left = mem.slice(
      bufBase,
      PCM_DMA_BUF_SIZE + halfOffset,
      samplesPerVBlank,
    );

    // Interleave the deinterleaved L/R channels into LRLR for ffmpeg's
    // `-f s8 -ac 2` reader (channel 0 = left). m4a's native buffer is
    // deinterleaved; the join happens here once per frame.
    const out = Buffer.alloc(samplesPerVBlank * 2);
    for (let i = 0; i < samplesPerVBlank; i++) {
      out[i * 2] = left[i];
      out[i * 2 + 1] = right[i];
    }

    return { pcm: out, freqHz, frames: samplesPerVBlank };
  }

  return {
    bindExports,
    gSoundInfoAddr: () => gSoundInfoAddr,
    initEngine,
    tickAndDrain,
  };
}
