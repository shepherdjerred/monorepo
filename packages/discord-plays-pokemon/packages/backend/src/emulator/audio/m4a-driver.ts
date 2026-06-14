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

export function createM4aDriver(mem: M4aMemory): M4aDriver {
  let m4aSoundMain: (() => void) | undefined;
  let gSoundInfoAddr = 0;

  function bindExports(exports: WebAssembly.Exports): void {
    m4aSoundMain = requireFunction(exports, "m4aSoundMain");
    gSoundInfoAddr = readGlobalNumber(exports, "gSoundInfo");
  }

  function tickAndDrain(): DrainResult | null {
    if (m4aSoundMain === undefined) return null;
    m4aSoundMain();

    const freqHz = mem.s32(gSoundInfoAddr, SI.pcmFreq);
    const samplesPerVBlank = mem.s32(gSoundInfoAddr, SI.pcmSamplesPerVBlank);
    if (freqHz <= 0 || samplesPerVBlank <= 0) return null;

    // The mixer writes into the half NOT being DMA'd. After m4aSoundMain
    // returns, the buffer half indicated by `pcmDmaCounter` is the freshly
    // written one. (Either half being treated as "just produced" depends on
    // the runtime; ffmpeg's jitter buffer absorbs occasional 1-frame skew.)
    const dmaCounter = mem.u8(gSoundInfoAddr, SI.pcmDmaCounter);
    const halfOffset = (dmaCounter & 1) === 0 ? 0 : samplesPerVBlank;

    const bufBase = gSoundInfoAddr + SI.pcmBuffer;
    const right = mem.slice(bufBase, halfOffset, samplesPerVBlank);
    const left = mem.slice(
      bufBase,
      PCM_DMA_BUF_SIZE + halfOffset,
      samplesPerVBlank,
    );

    // Interleave R/L into LRLR... for ffmpeg's `-f s8 -ac 2` reader. m4a's
    // native buffer is deinterleaved; the join happens here once per frame.
    const out = Buffer.alloc(samplesPerVBlank * 2);
    for (let i = 0; i < samplesPerVBlank; i++) {
      out[i * 2] = left[i];
      out[i * 2 + 1] = right[i];
    }

    return { pcm: out, freqHz, frames: samplesPerVBlank };
  }

  return { bindExports, tickAndDrain };
}
