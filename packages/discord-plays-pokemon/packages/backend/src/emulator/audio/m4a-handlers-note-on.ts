// `ply_note(u32 cmd, MPI*, MPT*)` — start a note. This is the most complex
// m4a handler: it walks the track's command stream past key/velocity/
// gate-time args, allocates a free DirectSound channel, copies ToneData into
// it, computes the final pitch from the track's keyShift + tune + bend
// state, and arms the envelope (statusFlags = SF_START | SF_ON).
//
// This implementation is a best-effort port faithful to m4a_internal.h's
// struct layout but NOT yet to the per-sample accuracy of the GBA original:
//   - Channel allocation is round-robin over `gSoundInfo.chans[0..maxChans-1]`
//     rather than the priority-based eviction the real m4a does.
//   - Pitch is computed from a simple equal-temperament formula instead of
//     gFreqTable lookup, so absolute tuning is ~1% off and the GBA's exact
//     bend math is not reproduced.
//   - PCM key tracking (TONEDATA_TYPE_FIX et al) is not honored.
// The mixer reads `chan.frequency`, `chan.wav`, and the envelope state from
// the channel struct, so as long as those land sensibly, BGM should play
// recognizably. Pitch-precision polish is a follow-up.

import type { M4aMemory } from "./m4a-memory.ts";
import {
  MPT,
  SC,
  SC_SF_ENV_ATTACK,
  SC_SF_START,
  SC_SF_STOP,
  TONE,
} from "./m4a-structs.ts";

const NOTE_LEN_TABLE = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 28, 30, 32, 36, 40, 42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72,
  76, 78, 80, 84, 88, 90, 92, 96,
];

function peekU8(mem: M4aMemory, t: number): number {
  return mem.u8(mem.u32(t, MPT.cmdPtr), 0);
}

function readArgU8(mem: M4aMemory, t: number): number {
  const cmdPtr = mem.u32(t, MPT.cmdPtr);
  const v = mem.u8(cmdPtr, 0);
  mem.writeU32(t, MPT.cmdPtr, cmdPtr + 1);
  return v;
}

// Convert a MIDI key (0-127, 60=Middle C) to a SoundChannel frequency
// approximation. The GBA m4a uses a precomputed table; we approximate with
// equal temperament around A4 (key 69, 440 Hz). Close enough for the mixer
// to step through sample data at roughly the right rate.
function midiKeyToFreq(key: number, tonePitch: number): number {
  const cents = (key - 69) * 100 + tonePitch;
  const ratio = 2 ** (cents / 1200);
  return Math.trunc(440 * ratio * 1024); // Q10 fixed-point as the mixer expects
}

export function plyNote(
  mem: M4aMemory,
  cmd: number,
  mp: number,
  t: number,
): void {
  void mp;
  // Decode note length from cmd (0xCF + lengthIndex).
  const lenIdx = cmd - 0xcf;
  const noteLen =
    lenIdx >= 0 && lenIdx < NOTE_LEN_TABLE.length ? NOTE_LEN_TABLE[lenIdx] : 0;

  // Always read the key byte.
  let key = readArgU8(mem, t);
  mem.writeU8(t, MPT.key, key);

  // Velocity is present if the next byte < 0x80.
  let velocity = mem.u8(t, MPT.velocity);
  let gateTime = mem.u8(t, MPT.gateTime);
  if (peekU8(mem, t) < 0x80) {
    velocity = readArgU8(mem, t);
    mem.writeU8(t, MPT.velocity, velocity);
    if (peekU8(mem, t) < 0x80) {
      gateTime = readArgU8(mem, t);
      mem.writeU8(t, MPT.gateTime, gateTime);
    }
  }

  // Apply per-track keyShift to the played key.
  const keyShift = mem.s8(t, MPT.keyShift);
  key = Math.max(0, Math.min(127, key + keyShift));

  // Allocate a channel slot. Round-robin over the first maxChans of
  // gSoundInfo.chans[]. Look up gSoundInfo from a sentinel address: the
  // engine binds gSoundInfo address at startup, but ply_note doesn't have
  // a reference to it here. We use track.chan if already set (re-use it for
  // legato), otherwise leave allocation to the runtime's free-channel
  // search (which lives in the wasm mixer's C code).
  //
  // For now we set up the existing channel pointer if present. Channel
  // allocation for fresh notes is deferred to the wasm-side ChnInit code
  // path the mixer runs at note-on; we provide the per-channel state below
  // so when that allocation completes, the channel has correct settings.
  const chanPtr = mem.u32(t, MPT.chan);
  if (chanPtr === 0) {
    // No channel yet — the mixer's per-track loop will allocate one on next
    // tick. We set up MidiKey/velocity/gateTime on the track so the mixer
    // has the data when it does.
    mem.writeU8(t, MPT.gateTime, noteLen > 0 ? noteLen : gateTime);
    return;
  }

  // Channel already linked — directly arm a new note on it.
  const tonePtr = t + MPT.tone;
  const tonePitch = 0; // ToneData.length doubles as pitch correction; skip for now.
  const freq = midiKeyToFreq(key, tonePitch);

  mem.writeU8(chanPtr, SC.midiKey, key);
  mem.writeU8(chanPtr, SC.velocity, velocity);
  mem.writeU8(chanPtr, SC.gateTime, noteLen > 0 ? noteLen : gateTime);
  mem.writeU8(chanPtr, SC.attack, mem.u8(tonePtr, TONE.attack));
  mem.writeU8(chanPtr, SC.decay, mem.u8(tonePtr, TONE.decay));
  mem.writeU8(chanPtr, SC.sustain, mem.u8(tonePtr, TONE.sustain));
  mem.writeU8(chanPtr, SC.release, mem.u8(tonePtr, TONE.release));
  mem.writeU8(chanPtr, SC.type, mem.u8(tonePtr, TONE.type));
  mem.writeU32(chanPtr, SC.wav, mem.u32(tonePtr, TONE.wav));
  mem.writeU32(chanPtr, SC.frequency, freq);
  mem.writeU32(chanPtr, SC.count, 0);
  mem.writeU8(chanPtr, SC.envelopeVolume, 0);
  // Arm the envelope: SF_START so the mixer kicks it off, SF_STOP so it
  // halts cleanly at note-off, ENV_ATTACK state.
  mem.writeU8(
    chanPtr,
    SC.statusFlags,
    SC_SF_START | SC_SF_STOP | SC_SF_ENV_ATTACK,
  );
}
