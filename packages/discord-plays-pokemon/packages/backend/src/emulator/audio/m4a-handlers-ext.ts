// Extended-op handlers + SampleFreqSet + Pokémon-cry stubs.
//
// The wasm imports `ply_xxx` as the extended-op prefix entry but ALSO imports
// each individual extended op (`ply_xwave`, `ply_xtype`, etc.) — the runtime
// dispatches directly to those, so `ply_xxx` itself is effectively a marker.
//
// SampleFreqSet is the one engine-control function we MUST implement: it
// writes `gSoundInfo.{freq,pcmFreq,pcmSamplesPerVBlank}`, and the driver
// short-circuits to silence until they are non-zero. The GBA original looks
// values up in `gFreqTable[]` / `gPcmSamplesPerVBlankTable[]`; we mirror the
// stock Emerald table inline (freq index 4 = 13379 Hz is the default).

import type { M4aMemory } from "./m4a-memory.ts";
import { MPT, SI } from "./m4a-structs.ts";

function readArgU8(mem: M4aMemory, t: number): number {
  const cmdPtr = mem.u32(t, MPT.cmdPtr);
  const v = mem.u8(cmdPtr, 0);
  mem.writeU32(t, MPT.cmdPtr, cmdPtr + 1);
  return v;
}

// Freq index → (Hz, samples-per-VBlank). Indices are the SOUND_MODE_FREQ_*
// enum's (bits 16-19) values; lifted from pret/pokeemerald m4a tables. The
// VBlank-sample counts are `round(Hz / 59.7275)`.
const FREQ_TABLE: { hz: number; samples: number }[] = [
  { hz: 0, samples: 0 }, // 0: invalid
  { hz: 5734, samples: 96 }, // 1
  { hz: 7884, samples: 132 }, // 2
  { hz: 10_512, samples: 176 }, // 3
  { hz: 13_379, samples: 224 }, // 4  ← Emerald default
  { hz: 15_768, samples: 264 }, // 5
  { hz: 18_157, samples: 304 }, // 6
  { hz: 21_024, samples: 352 }, // 7
  { hz: 26_758, samples: 448 }, // 8
  { hz: 31_536, samples: 528 }, // 9
  { hz: 36_314, samples: 608 }, // 10
  { hz: 40_137, samples: 672 }, // 11
  { hz: 42_048, samples: 704 }, // 12
];

// The wasm calls `SampleFreqSet(idx)` from inside `m4aSoundMode` after the
// latter extracts the freq bits from its mode argument. So `idx` here is the
// 0..0xc index into the GBA's frequency tables — NOT the raw SOUND_MODE_FREQ
// bits — and we look up Hz / samples-per-VBlank directly from it.
export function sampleFreqSet(
  mem: M4aMemory,
  gSoundInfoAddr: number,
  idx: number,
): void {
  if (gSoundInfoAddr === 0) return;
  const bounded = idx >= 0 && idx < FREQ_TABLE.length ? idx : 4;
  const entry = FREQ_TABLE[bounded];
  if (entry.hz === 0) return; // freq index 0 is "invalid" in the GBA table.
  mem.writeU8(gSoundInfoAddr, SI.freq, bounded);
  mem.writeS32(gSoundInfoAddr, SI.pcmFreq, entry.hz);
  mem.writeS32(gSoundInfoAddr, SI.pcmSamplesPerVBlank, entry.samples);
  // divFreq is used by the mixer to step through PCM samples; approximate it
  // as the reciprocal of pcmFreq in a Q15 fixed-point representation. The
  // exact GBA formula is `(1 << 24) / pcmFreq`.
  mem.writeS32(gSoundInfoAddr, SI.divFreq, Math.trunc((1 << 24) / entry.hz));
}

// ply_xxx — extended-op prefix (0xCD). The wasm's track interpreter calls
// this AND the specific xcmd handler; we treat this entry as a no-op since
// the dispatch happens upstream of our handler table.
export function plyXxx(_mem: M4aMemory, _mp: number, _t: number): void {
  // Intentional no-op.
}

// ply_xcmd — generic xcmd dispatcher. Like ply_xxx, the real dispatch
// happens in the wasm's table; we just acknowledge the call.
export function plyXcmd(_mem: M4aMemory, _mp: number, _t: number): void {
  // Intentional no-op.
}

// ply_xiecv / ply_xiecl — pseudo-echo volume / length. 1-byte each.
export function plyXiecv(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.pseudoEchoVolume, v);
}

export function plyXiecl(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.pseudoEchoLength, v);
}

// ply_xleng / ply_xswee / ply_xwait / ply_xcmd_0D — rare extended ops; the
// real impls tweak per-track scratch state. Consume the arg byte so cmdPtr
// advances correctly; precise behavior is a polish follow-up.
export function plyXleng(mem: M4aMemory, _mp: number, t: number): void {
  void readArgU8(mem, t);
}
export function plyXswee(mem: M4aMemory, _mp: number, t: number): void {
  void readArgU8(mem, t);
}
export function plyXwait(mem: M4aMemory, _mp: number, t: number): void {
  void readArgU8(mem, t);
}
export function plyXcmd0D(mem: M4aMemory, _mp: number, t: number): void {
  // The 0x0D xcmd takes 4 bytes (direct param write); consume them.
  void readArgU8(mem, t);
  void readArgU8(mem, t);
  void readArgU8(mem, t);
  void readArgU8(mem, t);
}
