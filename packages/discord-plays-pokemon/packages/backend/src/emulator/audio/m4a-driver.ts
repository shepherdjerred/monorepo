// Per-frame PCM drain from the wasm's m4a engine.
//
// The wasm (built from ottohg/pokeemerald-wasm) runs the full m4a sequencer +
// software mixer internally — every `WasmRunFrame` advances tracks, mixes
// channels, and writes the freshly-mixed PCM into `gSoundInfo.pcmBuffer`. The
// host's only job is to read the buffer once per frame and hand it to ffmpeg.
//
// Buffer layout (`src/m4a_wasm.c:1389` in ottohg's fork, mirroring
// `pret/pokeemerald` `include/gba/m4a_internal.h`):
//   - `gSoundInfo` lives at the address exported as the wasm global `gSoundInfo`.
//   - `gSoundInfo.pcmFreq`              s32 at offset 20 — sample rate (Hz).
//   - `gSoundInfo.pcmSamplesPerVBlank`  s32 at offset 16 — samples per frame.
//   - `gSoundInfo.pcmBuffer`            s8  at offset 848 — `[L*n, R*n]` (no
//                                       double-buffering in ottohg's port; the
//                                       buffer is rewritten in place each
//                                       VBlank).
// Left channel: `pcmBuffer[0..n)`. Right channel: `pcmBuffer[1584..1584+n)`.
// The 1584 stride is `PCM_DMA_BUF_SIZE`, hard-coded by the engine.

const SI_PCM_SAMPLES = 16;
const SI_PCM_FREQ = 20;
const SI_PCM_BUFFER = 848;
const PCM_DMA_BUF_SIZE = 1584;

export type DrainResult = {
  /** Interleaved s8 stereo PCM (LRLR...) sized `frames * 2` bytes. Ready for
   * ffmpeg `-f s8 -ac 2 -ar <freqHz>`. */
  pcm: Buffer;
  /** Native sample rate the wasm mixed at. Emerald defaults to ~13379 Hz. */
  freqHz: number;
  /** Number of stereo frames in `pcm` (== samplesPerVBlank). */
  frames: number;
};

export type M4aDriver = {
  /** Bind the wasm exports we read. Call once after `WebAssembly.instantiate`. */
  bindExports: (exports: WebAssembly.Exports) => void;
  /** Refresh the cached linear-memory view. Call after instantiation and any
   * subsequent memory grow (wasm linear memory is fixed-size in this build, so
   * once is enough). */
  refresh: (memory: WebAssembly.Memory) => void;
  /** Drain one VBlank's worth of PCM. Returns null until the wasm has booted
   * audio (i.e. `pcmFreq` / `pcmSamplesPerVBlank` are populated by
   * `m4aSoundInit`, which the game runs during boot). */
  drain: () => DrainResult | null;
};

function readGlobalNumber(exports: WebAssembly.Exports, name: string): number {
  const value = exports[name];
  if (!(value instanceof WebAssembly.Global)) {
    throw new TypeError(
      `wasm module is missing required audio global export: ${name}`,
    );
  }
  // WebAssembly.Global.value is typed `any` (i32/f32/f64/bigint/externref).
  // Narrow through `unknown` to avoid the banned `as` cast.
  const raw: unknown = value.value;
  if (typeof raw !== "number") {
    throw new TypeError(`audio global ${name} is not a number-valued global`);
  }
  return raw;
}

export function createM4aDriver(): M4aDriver {
  let gSoundInfoAddr = 0;
  let u8 = new Uint8Array(0);
  let dv = new DataView(new ArrayBuffer(0));

  function bindExports(exports: WebAssembly.Exports): void {
    gSoundInfoAddr = readGlobalNumber(exports, "gSoundInfo");
  }

  function refresh(memory: WebAssembly.Memory): void {
    u8 = new Uint8Array(memory.buffer);
    dv = new DataView(memory.buffer);
  }

  function drain(): DrainResult | null {
    if (gSoundInfoAddr === 0) return null;
    const freqHz = dv.getInt32(gSoundInfoAddr + SI_PCM_FREQ, true);
    const samples = dv.getInt32(gSoundInfoAddr + SI_PCM_SAMPLES, true);
    if (freqHz <= 0 || samples <= 0 || samples > PCM_DMA_BUF_SIZE) return null;

    const base = gSoundInfoAddr + SI_PCM_BUFFER;
    // The L and R halves live in one s8 buffer; we copy out an interleaved
    // LRLR Buffer ready for ffmpeg without an extra walk.
    const out = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      out[i * 2] = u8[base + i];
      out[i * 2 + 1] = u8[base + PCM_DMA_BUF_SIZE + i];
    }

    return { pcm: out, freqHz, frames: samples };
  }

  return { bindExports, refresh, drain };
}
