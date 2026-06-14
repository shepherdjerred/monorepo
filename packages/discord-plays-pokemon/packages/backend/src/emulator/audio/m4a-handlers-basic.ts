// Simple parameter-setter handlers for the m4a track-command interpreter.
// Each handler advances `track.cmdPtr` past its argument byte(s) and updates a
// track field. The exported m4a mixer in the wasm picks up the change on the
// next sample tick via the `MPT_FLG_VOL/PITCHG` dirty flags.
//
// Function names are JS-friendly camelCase; the wasm-side import keys
// (`ply_vol`, `ply_pan`, etc.) are mapped to these in `audio/index.ts`.

import type { M4aMemory } from "./m4a-memory.ts";
import { MPI, MPT, MPT_FLG_PITCHG, MPT_FLG_VOLCHG } from "./m4a-structs.ts";

function readArgU8(mem: M4aMemory, track: number): number {
  const cmdPtr = mem.u32(track, MPT.cmdPtr);
  const value = mem.u8(cmdPtr, 0);
  mem.writeU32(track, MPT.cmdPtr, cmdPtr + 1);
  return value;
}

function orFlag(mem: M4aMemory, track: number, bits: number): void {
  mem.writeU8(track, MPT.flags, mem.u8(track, MPT.flags) | bits);
}

// ply_vol — opcode 0xBD: set track master volume (0–127). Marks vol-changed.
export function plyVol(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.vol, v);
  orFlag(mem, t, MPT_FLG_VOLCHG);
}

// ply_pan — opcode 0xBE: set track pan (centered at C_V=0x40, signed).
export function plyPan(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  // Pan is stored as signed offset from center; m4a writes raw byte then the
  // mixer subtracts C_V on use. Match the runtime: store the signed offset.
  mem.writeS8(t, MPT.pan, v - 0x40);
  orFlag(mem, t, MPT_FLG_VOLCHG);
}

// ply_prio — opcode 0xB9: set track channel priority (0–255).
export function plyPrio(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.priority, v);
}

// ply_keysh — opcode 0xBB: set track key-shift (signed semitones).
export function plyKeysh(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeS8(t, MPT.keyShift, v);
  orFlag(mem, t, MPT_FLG_PITCHG);
}

// ply_tune — opcode 0xC8: set per-track fine tuning (signed, centered at C_V).
export function plyTune(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeS8(t, MPT.tune, v - 0x40);
  orFlag(mem, t, MPT_FLG_PITCHG);
}

// ply_bendr — opcode 0xC0: set pitch-bend range (1..96 semitones).
export function plyBendr(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.bendRange, v);
  orFlag(mem, t, MPT_FLG_PITCHG);
}

// ply_bend — opcode 0xBF: set pitch-bend value (signed, centered at C_V).
export function plyBend(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeS8(t, MPT.bend, v - 0x40);
  orFlag(mem, t, MPT_FLG_PITCHG);
}

// ply_lfos — opcode 0xC1: set LFO speed (0..255).
export function plyLfos(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.lfoSpeed, v);
  if (v === 0) mem.writeS8(t, MPT.modM, 0);
}

// ply_lfodl — opcode 0xC2: set LFO delay (0..255 game ticks).
export function plyLfodl(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.lfoDelay, v);
  mem.writeU8(t, MPT.lfoDelayC, v);
}

// ply_mod — opcode 0xC3: set modulation depth (0..127).
export function plyMod(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.mod, v);
  if (v === 0) mem.writeS8(t, MPT.modM, 0);
}

// ply_modt — opcode 0xC4: set modulation type (0=pitch, 1=volume, 2=pan).
export function plyModt(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.modT, v);
}

// ply_fine — opcode 0xB1: end-of-track marker. Clear MPT_FLG_EXIST so the
// dispatcher stops scheduling this track and the channel quiets.
export function plyFine(mem: M4aMemory, _mp: number, t: number): void {
  // Reset the entire track flag byte; the runtime relies on flags=0 to mean
  // "track stopped" and ignore further dispatch attempts.
  mem.writeU8(t, MPT.flags, 0);
}

// ply_tempo — opcode 0xBA: set song tempo. Argument byte is the tempo / 2
// (game stores it doubled). Updates MusicPlayerInfo's tempo accumulator base.
export function plyTempo(mem: M4aMemory, mp: number, t: number): void {
  const v = readArgU8(mem, t);
  // Set tempoD to bpm/2 * 2 = bpm. The precise tempoU/tempoI derivation
  // belongs to TrkVolPitSet-style helpers which are TODO. For now the value
  // is captured into the MusicPlayerInfo tempo base.
  mem.writeU16(mp, MPI.tempoD, v << 1);
}
