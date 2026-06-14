// Per-frame PCM drain from the wasm's m4a engine.
//
// The wasm (built from ottohg/pokeemerald-wasm) runs the full m4a sequencer +
// software mixer internally — every `WasmRunFrame` advances tracks, mixes
// channels, and writes the freshly-mixed PCM into per-channel Float32 buffers
// `gWasmPcmL` / `gWasmPcmR`. The host's only job is to read them once per
// frame and hand the interleaved samples to ffmpeg as `-f f32le -ac 2`.
//
// Why Float32 and not the s8 `gSoundInfo.pcmBuffer`? Both are written by the
// mixer with the same per-sample contributions, but the s8 path clamps each
// sample to a ±127 byte before storage. The 8-bit quantisation noise floor
// sits ~40 dB below the signal and is audible as hiss. The Float32 path
// (`gWasmPcmL`/`R`, added by ottohg `65a85af`) keeps the un-quantised mixer
// output, so the only noise in the chain is whatever ffmpeg's Opus encoder
// introduces downstream. See `src/m4a_wasm.c:1389-1404` in ottohg's fork.
//
// Buffer layout (see same source):
//   - `gSoundInfo.pcmFreq`              s32 at offset 20 in `gSoundInfo`.
//   - `gSoundInfo.pcmSamplesPerVBlank`  s32 at offset 16 in `gSoundInfo`.
//   - `gWasmPcmL` / `gWasmPcmR`         Float32 arrays sized at least
//                                       `pcmSamplesPerVBlank`, rewritten in
//                                       place each VBlank (no double-buffer).

const SI_PCM_SAMPLES = 16;
const SI_PCM_FREQ = 20;
// PCM_DMA_BUF_SIZE is the per-channel hard cap on samplesPerVBlank in the
// wasm engine (`src/m4a_wasm.c:739`); we use it as a sanity bound on the
// number of samples we read so a corrupt struct doesn't run us off the end.
const PCM_DMA_BUF_SIZE = 1584;

export type DrainResult = {
  /** Interleaved Float32 stereo PCM (`L0 R0 L1 R1 …`) sized `frames * 8`
   * bytes. Ready for ffmpeg `-f f32le -ac 2 -ar <freqHz>`. */
  pcm: Buffer;
  /** Native sample rate the wasm mixed at. Emerald defaults to ~13379 Hz. */
  freqHz: number;
  /** Number of stereo frames in `pcm` (== samplesPerVBlank). */
  frames: number;
};

export type M4aDriver = {
  /** Bind the wasm exports we read. Call once after `WebAssembly.instantiate`. */
  bindExports: (exports: WebAssembly.Exports) => void;
  /** Refresh the cached linear-memory view. Call after instantiation; the
   * wasm linear memory in this build is fixed-size so once is enough. */
  refresh: (memory: WebAssembly.Memory) => void;
  /** Drain one VBlank's worth of PCM. Returns null until the wasm has booted
   * audio (`pcmFreq` / `pcmSamplesPerVBlank` populated by `m4aSoundInit`). */
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
  let gWasmPcmLAddr = 0;
  let gWasmPcmRAddr = 0;
  let dv = new DataView(new ArrayBuffer(0));
  let f32 = new Float32Array(0);

  function bindExports(exports: WebAssembly.Exports): void {
    gSoundInfoAddr = readGlobalNumber(exports, "gSoundInfo");
    gWasmPcmLAddr = readGlobalNumber(exports, "gWasmPcmL");
    gWasmPcmRAddr = readGlobalNumber(exports, "gWasmPcmR");
  }

  function refresh(memory: WebAssembly.Memory): void {
    dv = new DataView(memory.buffer);
    f32 = new Float32Array(memory.buffer);
  }

  function drain(): DrainResult | null {
    if (gSoundInfoAddr === 0) return null;
    const freqHz = dv.getInt32(gSoundInfoAddr + SI_PCM_FREQ, true);
    const samples = dv.getInt32(gSoundInfoAddr + SI_PCM_SAMPLES, true);
    if (freqHz <= 0 || samples <= 0 || samples > PCM_DMA_BUF_SIZE) return null;

    // gWasmPcmL/R live as Float32 arrays. Float32Array(buffer) reads at u32
    // indices, so divide the byte address by 4 to get the start index.
    const lStart = gWasmPcmLAddr >>> 2;
    const rStart = gWasmPcmRAddr >>> 2;
    // Interleave LRLR into a Buffer so the consumer can write it straight to
    // an ffmpeg `-f f32le -ac 2` stdin.
    const out = Buffer.alloc(samples * 8);
    for (let i = 0; i < samples; i++) {
      out.writeFloatLE(f32[lStart + i], i * 8);
      out.writeFloatLE(f32[rStart + i], i * 8 + 4);
    }

    return { pcm: out, freqHz, frames: samples };
  }

  return { bindExports, refresh, drain };
}
