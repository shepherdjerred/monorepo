// Envelope / fade / portamento handlers. The LFO state machine itself lives
// inside the wasm-compiled mixer; the handlers here only kick off envelopes
// and let the mixer advance per-sample state from there.

import type { M4aMemory } from "./m4a-memory.ts";
import { FADE_VOL_MAX, MPI, MPT } from "./m4a-structs.ts";

function readArgU8(mem: M4aMemory, t: number): number {
  const cmdPtr = mem.u32(t, MPT.cmdPtr);
  const value = mem.u8(cmdPtr, 0);
  mem.writeU32(t, MPT.cmdPtr, cmdPtr + 1);
  return value;
}

// ply_port — opcode 0xC7: portamento (pitch slide) setup. Argument: 1-byte
// key marker. The real handler updates the per-channel pitch interpolation
// state; for now we consume the byte so cmdPtr advances correctly. Portamento
// is rare in Emerald BGM; skipping the precise slide math costs little.
export function plyPort(mem: M4aMemory, _mp: number, t: number): void {
  void readArgU8(mem, t);
}

// FadeOutBody(MusicPlayerInfo*) — called per VBlank when a fade is active.
// Decrements the fade counter; when it hits 0, advances the fade volume by
// one step. When fadeOV reaches its limit (0 for fade-out, MAX for fade-in),
// clears the fade so this body isn't called again.
//
// The mixer reads `fadeOV` and scales each track's effective volume by it,
// so we only update the volume value here — no need to walk tracks.
export function fadeOutBody(mem: M4aMemory, mp: number, _t: number): void {
  const fadeOI = mem.u16(mp, MPI.fadeOI);
  if (fadeOI === 0) return; // no active fade
  let fadeOC = mem.u16(mp, MPI.fadeOC);
  if (fadeOC > 0) {
    fadeOC -= 1;
    mem.writeU16(mp, MPI.fadeOC, fadeOC);
    return;
  }
  // Counter elapsed — step volume and reset counter.
  let fadeOV = mem.u16(mp, MPI.fadeOV);
  // Bit 1 of fadeOI distinguishes fade-out from fade-in (FADE_IN flag).
  const isFadeIn = (fadeOI & 0x00_02) !== 0;
  if (isFadeIn) {
    fadeOV += 1;
    if (fadeOV >= FADE_VOL_MAX) {
      fadeOV = FADE_VOL_MAX;
      mem.writeU16(mp, MPI.fadeOI, 0);
    }
  } else {
    if (fadeOV > 0) fadeOV -= 1;
    if (fadeOV === 0) {
      mem.writeU16(mp, MPI.fadeOI, 0);
    }
  }
  mem.writeU16(mp, MPI.fadeOV, fadeOV);
  // Reset counter to the per-step interval (low byte of fadeOI).
  mem.writeU16(mp, MPI.fadeOC, fadeOI & 0xff);
}
