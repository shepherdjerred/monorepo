// Headless m4a audio engine for pokeemerald-wasm. Splits cleanly in two:
//
//  1. **Imports**: JS implementations of the GBA m4a track-command opcodes
//     (`ply_*`, `SetPokemonCry*`, etc.) the wasm imports as functions. Without
//     these, the wasm's track interpreter advances no state and the mixer
//     produces silence. See `m4a-handlers-*.ts`.
//
//  2. **Driver**: a per-frame tick that calls the exported `m4aSoundMain`
//     mixer and drains the produced PCM out of `SoundMainRAM_Buffer`. See
//     `m4a-driver.ts`.
//
// Status: Phase 2a — simple parameter setters only. Complex handlers (control
// flow, envelope/note state machines, voice/ADSR, extended ops) are stubbed
// with no-op returns and tracked under `packages/docs/todos/dpp-audio-handlers.md`.
// The engine compiles and the pipeline runs; audio output is silent until the
// handler set is complete.

import type { DrainResult } from "./m4a-driver.ts";
import { createM4aDriver } from "./m4a-driver.ts";
import type { M4aMemory } from "./m4a-memory.ts";
import { createM4aMemory } from "./m4a-memory.ts";
import {
  plyBend,
  plyBendr,
  plyFine,
  plyKeysh,
  plyLfodl,
  plyLfos,
  plyMod,
  plyModt,
  plyPan,
  plyPrio,
  plyTempo,
  plyTune,
  plyVol,
} from "./m4a-handlers-basic.ts";

export type AudioExtras = Record<string, (args: number[]) => number>;

export type AudioEngine = {
  refresh: (memory: WebAssembly.Memory) => void;
  bindExports: (exports: WebAssembly.Exports) => void;
  /** Import overrides keyed by symbol name. Pass into `bios.imports(...)`. */
  extras: AudioExtras;
  tickAndDrain: () => DrainResult | null;
};

type TrackHandler = (mem: M4aMemory, mp: number, track: number) => void;

// Wasm-side import-key strings (matching the GBA m4a opcode names) mapped to
// our JS handler functions. Keys MUST match the wasm imports literally; the
// JS function names are normal camelCase.
const TRACK_HANDLER_NAMES: { name: string; fn: TrackHandler }[] = [
  { name: "ply_fine", fn: plyFine },
  { name: "ply_vol", fn: plyVol },
  { name: "ply_pan", fn: plyPan },
  { name: "ply_prio", fn: plyPrio },
  { name: "ply_keysh", fn: plyKeysh },
  { name: "ply_tune", fn: plyTune },
  { name: "ply_bend", fn: plyBend },
  { name: "ply_bendr", fn: plyBendr },
  { name: "ply_lfos", fn: plyLfos },
  { name: "ply_lfodl", fn: plyLfodl },
  { name: "ply_mod", fn: plyMod },
  { name: "ply_modt", fn: plyModt },
  { name: "ply_tempo", fn: plyTempo },
];

// Stub handlers — return 0 so the wasm's track interpreter and the mixer don't
// crash. Audible consequence is silence; tracked at
// `packages/docs/todos/dpp-audio-handlers.md`.
const NOOP_NAMES = [
  // Control flow + memacc.
  "ply_goto",
  "ply_patt",
  "ply_pend",
  "ply_rept",
  "ply_memacc",
  // Notes + voice + ADSR + extended ops.
  "ply_voice",
  "ply_port",
  "ply_xcmd",
  "ply_endtie",
  "ply_xxx",
  "ply_xwave",
  "ply_xtype",
  "ply_xatta",
  "ply_xdeca",
  "ply_xsust",
  "ply_xrele",
  "ply_xiecv",
  "ply_xiecl",
  "ply_xleng",
  "ply_xswee",
  "ply_xwait",
  "ply_xcmd_0D",
  // Engine control.
  "TrackStop",
  "FadeOutBody",
  "TrkVolPitSet",
  "SampleFreqSet",
  // Pokémon cry family. `IsPokemonCryPlaying` returns 0 so callers don't spin
  // forever; cry-task code in the game has timeout fallbacks.
  "SetPokemonCryVolume",
  "SetPokemonCryPanpot",
  "SetPokemonCryPitch",
  "SetPokemonCryLength",
  "SetPokemonCryProgress",
  "SetPokemonCryRelease",
  "SetPokemonCryChorus",
  "SetPokemonCryTone",
  "SetPokemonCryStereo",
  "SetPokemonCryPriority",
  "IsPokemonCryPlaying",
];

function noop(): number {
  return 0;
}

export function createAudioEngine(): AudioEngine {
  const mem = createM4aMemory();
  const driver = createM4aDriver(mem);

  const extras: AudioExtras = {};
  for (const { name, fn } of TRACK_HANDLER_NAMES) {
    extras[name] = (args) => {
      // m4a track-cmd handler signature: (MusicPlayerInfo*, MusicPlayerTrack*).
      fn(mem, args[0], args[1]);
      return 0;
    };
  }
  for (const name of NOOP_NAMES) extras[name] = noop;

  return {
    refresh: (memory) => {
      mem.refresh(memory);
    },
    bindExports: (exports) => {
      driver.bindExports(exports);
    },
    extras,
    tickAndDrain: () => driver.tickAndDrain(),
  };
}
