// Control-flow handlers for the m4a track-command interpreter: jumps,
// subpattern call/return, repeat-N, memory-accumulator ops, and the
// engine-side TrackStop. These advance `cmdPtr` non-sequentially and (for
// patt/pend) push or pop the 3-deep `patternStack`.
//
// Reference: pret/pokeemerald include/gba/m4a_internal.h:272-313 (MPT struct
// + patternStack[3]) and the m4a opcode reference. Algorithms are equivalent
// to ipatix/agbplay's MP2K sequencer.

import type { M4aMemory } from "./m4a-memory.ts";
import { MPT } from "./m4a-structs.ts";

// Read a little-endian u32 starting at `cmdPtr`, advance cmdPtr by 4.
function readArgU32(mem: M4aMemory, track: number): number {
  const cmdPtr = mem.u32(track, MPT.cmdPtr);
  const value = mem.u32(cmdPtr, 0);
  mem.writeU32(track, MPT.cmdPtr, cmdPtr + 4);
  return value;
}

function readArgU8(mem: M4aMemory, track: number): number {
  const cmdPtr = mem.u32(track, MPT.cmdPtr);
  const value = mem.u8(cmdPtr, 0);
  mem.writeU32(track, MPT.cmdPtr, cmdPtr + 1);
  return value;
}

// ply_goto — opcode 0xB2: absolute jump to a track byte address.
// Argument: 4-byte little-endian pointer.
export function plyGoto(mem: M4aMemory, _mp: number, t: number): void {
  const target = readArgU32(mem, t);
  mem.writeU32(t, MPT.cmdPtr, target);
}

// ply_patt — opcode 0xB3: call a subpattern. Push the post-argument cmdPtr to
// `patternStack[patternLevel]`, increment patternLevel, jump to target.
// Caps patternLevel at 3 (struct space); deeper calls are ignored (GBA hard
// limit).
export function plyPatt(mem: M4aMemory, _mp: number, t: number): void {
  const target = readArgU32(mem, t);
  const level = mem.u8(t, MPT.patternLevel);
  if (level < 3) {
    const returnAddr = mem.u32(t, MPT.cmdPtr);
    mem.writeU32(t, MPT.patternStack + level * 4, returnAddr);
    mem.writeU8(t, MPT.patternLevel, level + 1);
  }
  mem.writeU32(t, MPT.cmdPtr, target);
}

// ply_pend — opcode 0xB4: return from subpattern. Decrement patternLevel,
// restore cmdPtr from the top of the stack. No-op if no subpattern active.
export function plyPend(mem: M4aMemory, _mp: number, t: number): void {
  const level = mem.u8(t, MPT.patternLevel);
  if (level > 0) {
    const newLevel = level - 1;
    const restore = mem.u32(t, MPT.patternStack + newLevel * 4);
    mem.writeU8(t, MPT.patternLevel, newLevel);
    mem.writeU32(t, MPT.cmdPtr, restore);
  }
}

// ply_rept — opcode 0xB5: bounded repeat. Argument: 1-byte count + 4-byte
// target. count=0 means infinite (treat as unconditional goto). Otherwise
// jump to target while a per-track counter (`repN`) hasn't reached count,
// then fall through.
//
// State machine: when `repN` is 0, this is the first hit — initialize repN.
// Each subsequent hit decrements until 1, then resets and falls through.
export function plyRept(mem: M4aMemory, _mp: number, t: number): void {
  const count = readArgU8(mem, t);
  const target = readArgU32(mem, t);
  if (count === 0) {
    // Infinite loop: jump unconditionally.
    mem.writeU32(t, MPT.cmdPtr, target);
    return;
  }
  let repN = mem.u8(t, MPT.repN);
  if (repN === 0) repN = count;
  repN -= 1;
  mem.writeU8(t, MPT.repN, repN);
  if (repN > 0) mem.writeU32(t, MPT.cmdPtr, target);
}

// ply_memacc — opcode 0xB6: memory-accumulator op against gMPlayMemAccArea.
// Argument: 1-byte op + 1-byte addr + 1-byte data. The op byte selects a
// branch / arithmetic operation; rarely used outside debug/save flags. Most
// Pokémon songs never hit this, so we capture the arg consumption and
// implement the basic write/compare ops without skipping bytes the runtime
// expects to consume.
//
// Op encoding (from m4a docs):
//   0 = mem[addr] = data
//   1 = mem[addr] += data
//   2 = if mem[addr] != data then skip 1 cmd
//   (others rarely used; treat as no-op consumption)
export function plyMemacc(mem: M4aMemory, _mp: number, t: number): void {
  const op = readArgU8(mem, t);
  const addr = readArgU8(mem, t);
  const data = readArgU8(mem, t);
  // gMPlayMemAccArea is a fixed-size buffer in wasm linear memory addressed
  // by a wasm export. We don't have its address bound here yet; for now we
  // consume the args and no-op. Tracked in dpp-audio-handlers TODO doc as the
  // memacc finalization step.
  void op;
  void addr;
  void data;
}

// TrackStop(MusicPlayerInfo*, MusicPlayerTrack*) — stop a single track:
// clear its flags so the dispatcher stops scheduling it, and zero the
// channel pointer so any in-flight per-channel routines fast-bail.
export function trackStop(mem: M4aMemory, _mp: number, t: number): void {
  // If the track has an active channel, mark it stopped (statusFlags &= ~SF_ON).
  const chanPtr = mem.u32(t, MPT.chan);
  if (chanPtr !== 0) {
    // SoundChannel.statusFlags is at offset 0; SF_STOP=0x40 + clear SF_ON bits.
    const sf = mem.u8(chanPtr, 0);
    mem.writeU8(chanPtr, 0, (sf & ~0xd3) | 0x40);
  }
  mem.writeU8(t, MPT.flags, 0);
  mem.writeU32(t, MPT.chan, 0);
}
