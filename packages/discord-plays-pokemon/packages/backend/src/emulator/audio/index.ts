// Headless audio engine for `ottohg/pokeemerald-wasm`. The wasm runs the full
// m4a sequencer + DirectSound + CGB mixer internally; the host's only job is
// to read the freshly-mixed PCM buffer once per emulated frame. See
// `m4a-driver.ts` for the buffer layout.

import {
  createM4aDriver,
  type DrainResult,
  type M4aDriver,
} from "./m4a-driver.ts";

export type AudioEngine = {
  refresh: (memory: WebAssembly.Memory) => void;
  bindExports: (exports: WebAssembly.Exports) => void;
  /** Drain one VBlank's worth of PCM. Returns null until the wasm has booted
   * audio. */
  drain: () => DrainResult | null;
};

export function createAudioEngine(): AudioEngine {
  const driver: M4aDriver = createM4aDriver();
  return {
    refresh: (memory) => {
      driver.refresh(memory);
    },
    bindExports: (exports) => {
      driver.bindExports(exports);
    },
    drain: () => driver.drain(),
  };
}
