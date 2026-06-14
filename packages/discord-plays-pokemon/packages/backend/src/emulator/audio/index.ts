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
// Status: all wasm-side audio imports have a real impl, stubbed approximation,
// or arg-consuming no-op (every variant explicitly comments its fidelity). The
// note-on / per-channel pitch path is the lowest-fidelity area and the most
// likely to need iteration before BGM is recognizable.

import type { DrainResult } from "./m4a-driver.ts";
import { createM4aDriver } from "./m4a-driver.ts";
import type { M4aMemory } from "./m4a-memory.ts";
import { createM4aMemory } from "./m4a-memory.ts";
import { fadeOutBody, plyPort } from "./m4a-handlers-env.ts";
import {
  plyXcmd,
  plyXcmd0D,
  plyXiecl,
  plyXiecv,
  plyXleng,
  plyXswee,
  plyXwait,
  plyXxx,
  sampleFreqSet,
} from "./m4a-handlers-ext.ts";
import {
  plyGoto,
  plyMemacc,
  plyPatt,
  plyPend,
  plyRept,
  trackStop,
} from "./m4a-handlers-flow.ts";
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
import {
  plyEndtie,
  plyVoice,
  plyXatta,
  plyXdeca,
  plyXrele,
  plyXsust,
  plyXtype,
  plyXwave,
  trkVolPitSet,
} from "./m4a-handlers-note.ts";
import { plyNote } from "./m4a-handlers-note-on.ts";

export type AudioExtras = Record<string, (args: number[]) => number>;

export type AudioEngine = {
  refresh: (memory: WebAssembly.Memory) => void;
  bindExports: (exports: WebAssembly.Exports) => void;
  /** Bootstrap the wasm-side audio engine (`SoundInit` + `m4aSoundMode`). The
   * wasm doesn't do this on its own — see `m4a-driver.ts:initEngine`. */
  initEngine: () => void;
  /** Import overrides keyed by symbol name. Pass into `bios.imports(...)`. */
  extras: AudioExtras;
  tickAndDrain: () => DrainResult | null;
};

type TrackHandler = (mem: M4aMemory, mp: number, track: number) => void;

// Handlers with the standard `(MusicPlayerInfo*, MusicPlayerTrack*)` C
// signature — wasm passes args[0]=mp, args[1]=t.
const TRACK_HANDLERS: { name: string; fn: TrackHandler }[] = [
  // basic
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
  // flow
  { name: "ply_goto", fn: plyGoto },
  { name: "ply_patt", fn: plyPatt },
  { name: "ply_pend", fn: plyPend },
  { name: "ply_rept", fn: plyRept },
  { name: "ply_memacc", fn: plyMemacc },
  { name: "TrackStop", fn: trackStop },
  // env / port
  { name: "ply_port", fn: plyPort },
  { name: "FadeOutBody", fn: fadeOutBody },
  // voice / ADSR / endtie / TrkVolPitSet
  { name: "ply_voice", fn: plyVoice },
  { name: "ply_xwave", fn: plyXwave },
  { name: "ply_xtype", fn: plyXtype },
  { name: "ply_xatta", fn: plyXatta },
  { name: "ply_xdeca", fn: plyXdeca },
  { name: "ply_xsust", fn: plyXsust },
  { name: "ply_xrele", fn: plyXrele },
  { name: "ply_endtie", fn: plyEndtie },
  { name: "TrkVolPitSet", fn: trkVolPitSet },
  // extended ops
  { name: "ply_xxx", fn: plyXxx },
  { name: "ply_xcmd", fn: plyXcmd },
  { name: "ply_xiecv", fn: plyXiecv },
  { name: "ply_xiecl", fn: plyXiecl },
  { name: "ply_xleng", fn: plyXleng },
  { name: "ply_xswee", fn: plyXswee },
  { name: "ply_xwait", fn: plyXwait },
  { name: "ply_xcmd_0D", fn: plyXcmd0D },
];

// Pokémon-cry family: the wasm imports them but they don't drive BGM. Stub
// as no-ops; `IsPokemonCryPlaying` returns 0 so callers don't spin.
const CRY_NAMES = [
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
  // Bound at `bindExports`; SampleFreqSet needs `gSoundInfo`'s address to
  // write the freq fields the driver later reads.
  let gSoundInfoAddr = 0;

  const extras: AudioExtras = {};
  for (const { name, fn } of TRACK_HANDLERS) {
    extras[name] = (args) => {
      fn(mem, args[0], args[1]);
      return 0;
    };
  }

  // ply_note has a non-standard signature: (u32 note_cmd, MPI*, MPT*).
  extras.ply_note = (args) => {
    plyNote(mem, args[0], args[1], args[2]);
    return 0;
  };

  // SampleFreqSet(u32 freq) — one arg, no track context.
  extras.SampleFreqSet = (args) => {
    sampleFreqSet(mem, gSoundInfoAddr, args[0]);
    return 0;
  };

  for (const name of CRY_NAMES) extras[name] = noop;

  return {
    refresh: (memory) => {
      mem.refresh(memory);
    },
    bindExports: (exports) => {
      driver.bindExports(exports);
      gSoundInfoAddr = driver.gSoundInfoAddr();
    },
    initEngine: () => {
      driver.initEngine();
    },
    extras,
    tickAndDrain: () => driver.tickAndDrain(),
  };
}
