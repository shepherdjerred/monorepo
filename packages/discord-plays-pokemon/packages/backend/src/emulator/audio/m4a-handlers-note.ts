// Voice / instrument / ADSR / note-on handlers. These set up the
// per-channel DSP state the mixer reads each sample:
//   - `ply_voice` copies a ToneData entry from the song's voice group into
//     `track.tone` (so subsequent notes pick up the right instrument).
//   - `ply_x{wave,type,atta,deca,sust,rele}` override individual ToneData
//     fields without changing voice.
//   - `ply_endtie` terminates a tied note on a channel matching its key.
//   - `TrkVolPitSet` is called by the mixer when MPT_FLG_VOLCHG/PITCHG is set
//     on a track to recompute the channel's stereo volume + frequency.

import type { M4aMemory } from "./m4a-memory.ts";
import {
  MPI,
  MPT,
  MPT_FLG_PITCHG,
  MPT_FLG_PITSET,
  MPT_FLG_VOLCHG,
  MPT_FLG_VOLSET,
  SC,
  TONE,
  TONE_DATA_SIZE,
} from "./m4a-structs.ts";

function readArgU8(mem: M4aMemory, t: number): number {
  const cmdPtr = mem.u32(t, MPT.cmdPtr);
  const value = mem.u8(cmdPtr, 0);
  mem.writeU32(t, MPT.cmdPtr, cmdPtr + 1);
  return value;
}

function readArgU32(mem: M4aMemory, t: number): number {
  const cmdPtr = mem.u32(t, MPT.cmdPtr);
  const value = mem.u32(cmdPtr, 0);
  mem.writeU32(t, MPT.cmdPtr, cmdPtr + 4);
  return value;
}

// ply_voice — opcode 0xBC: select instrument. Argument: 1-byte voice index.
// Copies the 12-byte ToneData entry from the song's voice group (pointer
// stored in MusicPlayerInfo.tone) into the track's embedded tone.
export function plyVoice(mem: M4aMemory, mp: number, t: number): void {
  const voiceIdx = readArgU8(mem, t);
  const voiceGroupPtr = mem.u32(mp, MPI.tone);
  if (voiceGroupPtr === 0) return;
  const srcAddr = voiceGroupPtr + voiceIdx * TONE_DATA_SIZE;
  // Copy ToneData (12 bytes) field-by-field; mirrors the m4a runtime's
  // u8/u32/u8x4 layout copy.
  mem.writeU8(t, MPT.tone + TONE.type, mem.u8(srcAddr, TONE.type));
  mem.writeU8(t, MPT.tone + TONE.key, mem.u8(srcAddr, TONE.key));
  mem.writeU8(t, MPT.tone + TONE.length, mem.u8(srcAddr, TONE.length));
  mem.writeU8(t, MPT.tone + TONE.pan_sweep, mem.u8(srcAddr, TONE.pan_sweep));
  mem.writeU32(t, MPT.tone + TONE.wav, mem.u32(srcAddr, TONE.wav));
  mem.writeU8(t, MPT.tone + TONE.attack, mem.u8(srcAddr, TONE.attack));
  mem.writeU8(t, MPT.tone + TONE.decay, mem.u8(srcAddr, TONE.decay));
  mem.writeU8(t, MPT.tone + TONE.sustain, mem.u8(srcAddr, TONE.sustain));
  mem.writeU8(t, MPT.tone + TONE.release, mem.u8(srcAddr, TONE.release));
}

// ply_xwave — extended op: override the waveform pointer in the embedded
// ToneData. Argument: 4-byte little-endian pointer.
export function plyXwave(mem: M4aMemory, _mp: number, t: number): void {
  const wavPtr = readArgU32(mem, t);
  mem.writeU32(t, MPT.tone + TONE.wav, wavPtr);
}

// ply_xtype — extended op: override the ToneData type byte.
export function plyXtype(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.tone + TONE.type, v);
}

// ply_xatta / ply_xdeca / ply_xsust / ply_xrele — extended ops: override
// individual ADSR fields without changing voice.
export function plyXatta(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.tone + TONE.attack, v);
}
export function plyXdeca(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.tone + TONE.decay, v);
}
export function plyXsust(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.tone + TONE.sustain, v);
}
export function plyXrele(mem: M4aMemory, _mp: number, t: number): void {
  const v = readArgU8(mem, t);
  mem.writeU8(t, MPT.tone + TONE.release, v);
}

// ply_endtie — opcode 0xCE: terminate a tied note. Argument: 1-byte key. If
// the track has an active channel matching this key, flip its envelope state
// to RELEASE so the note decays naturally.
export function plyEndtie(mem: M4aMemory, _mp: number, t: number): void {
  const key = readArgU8(mem, t);
  const chanPtr = mem.u32(t, MPT.chan);
  if (chanPtr === 0) return;
  const chanKey = mem.u8(chanPtr, SC.midiKey);
  if (chanKey !== key) return;
  // Set release state on statusFlags: clear envelope bits (0x03), keep STOP.
  const sf = mem.u8(chanPtr, SC.statusFlags);
  mem.writeU8(chanPtr, SC.statusFlags, sf & ~0x03);
}

// TrkVolPitSet — called by the mixer when MPT_FLG_VOL/PITCHG dirty bits are
// set. Recomputes the channel's stereo amplitude from track vol + pan and
// clears the dirty flags. Pitch recompute is intentionally simplified: the
// mixer reads `chan.frequency` directly, which `ply_note` sets up on
// note-on, so mid-note pitch updates from `ply_bend`/`ply_keysh` are lossy
// here. Polishing the pitch path is a follow-up; getting basic volume +
// dirty-flag clearing landed unblocks audible output.
export function trkVolPitSet(mem: M4aMemory, _mp: number, t: number): void {
  const flags = mem.u8(t, MPT.flags);
  const chanPtr = mem.u32(t, MPT.chan);
  if (chanPtr === 0) {
    // No channel: just clear dirty bits so we don't re-enter every tick.
    mem.writeU8(t, MPT.flags, flags & ~(MPT_FLG_VOLCHG | MPT_FLG_PITCHG));
    return;
  }

  if ((flags & MPT_FLG_VOLSET) !== 0) {
    // Track master volume (0..127). Apply pan around center (C_V=0x40).
    // Pan is stored as signed offset already (see plyPan).
    const vol = mem.u8(t, MPT.vol);
    const pan = mem.s8(t, MPT.pan); // signed offset, -64..63
    // Convert to a 0..127 range per channel using a simple linear pan law.
    // pan -64 => all left, +63 => all right, 0 => centered (~vol/2 each).
    const leftScale = Math.max(0, 64 - pan) / 128;
    const rightScale = Math.max(0, 64 + pan) / 128;
    const left = Math.max(0, Math.min(127, Math.trunc(vol * leftScale)));
    const right = Math.max(0, Math.min(127, Math.trunc(vol * rightScale)));
    mem.writeU8(chanPtr, SC.leftVolume, left);
    mem.writeU8(chanPtr, SC.rightVolume, right);
    // Stamp the velocity-scaled envelope target so the mixer's per-sample
    // envelope advance lands at the right amplitude.
    mem.writeU8(chanPtr, SC.envelopeVolumeRight, right);
    mem.writeU8(chanPtr, SC.envelopeVolumeLeft, left);
  }

  if ((flags & MPT_FLG_PITSET) !== 0) {
    // Pitch recompute is left to ply_note + the mixer for now (see comment
    // above). Marker that this branch ran so we can revisit.
  }

  // Clear dirty bits so the mixer doesn't call us back every tick.
  mem.writeU8(t, MPT.flags, flags & ~(MPT_FLG_VOLCHG | MPT_FLG_PITCHG));
}
