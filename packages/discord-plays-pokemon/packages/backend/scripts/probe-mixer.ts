// Sanity probe: arm ONE SoundChannel by hand (statusFlags + waveform pointer
// + frequency + envelope) then tick m4aSoundMain a few times and inspect the
// PCM buffer. If RMS > 0 here, the mixer + driver work and the remaining
// silence in the e2e harness is purely a handler problem (channel
// allocation, instrument selection, etc.).

import { Emulator } from "#src/emulator/emulator.ts";
import {
  SC,
  SC_SF_ENV_ATTACK,
  SC_SF_START,
  SC_SF_STOP,
  SI,
} from "#src/emulator/audio/m4a-structs.ts";

const wasmPath = new URL("../assets/pokeemerald.wasm", import.meta.url)
  .pathname;
const emulator = new Emulator({ wasmPath });
await emulator.init();
emulator.initAudio();

const rawExportsMaybeUndefined = (
  emulator as unknown as { rawExports: WebAssembly.Exports | undefined }
).rawExports;
if (rawExportsMaybeUndefined === undefined) throw new Error("no exports");
// Capture as a new const so TypeScript can narrow the type for nested functions.
const rawExports: WebAssembly.Exports = rawExportsMaybeUndefined;
const gSI = rawExports.gSoundInfo;
const memory = rawExports.memory;
if (!(gSI instanceof WebAssembly.Global)) throw new Error("no gSoundInfo");
if (!(memory instanceof WebAssembly.Memory)) throw new Error("no memory");
const rawAddr: unknown = gSI.value;
if (typeof rawAddr !== "number") throw new Error("addr not number");
const gSIAddr = rawAddr;
const dv = new DataView(memory.buffer);

// Build a synthetic WaveData in linear memory: a small square-wave loop.
// WaveData layout (m4a_internal.h:39): u16 type, u16 status, u32 freq,
// u32 loopStart, u32 size, s8 data[].
// Plant it at a low-frequency unused address. The wasm linear memory at
// addresses < 0x500000 contains game data; we want a sandbox area. Use
// 0x07000000 — far above what the game uses — except linear memory is fixed
// at 256 MiB starting at 0, so any address < memory size works as long as we
// don't trample game state. Pick a high address.
const WAVE_ADDR = 0x0f_e0_00_00;
const WAVE_SAMPLES = 256;
const u8 = new Uint8Array(memory.buffer);
// Verify the address is in bounds.
if (WAVE_ADDR + WAVE_SAMPLES + 0x10 > u8.byteLength) {
  throw new Error(
    `wave address out of bounds: 0x${WAVE_ADDR.toString(16)} + ${String(
      WAVE_SAMPLES,
    )} > 0x${u8.byteLength.toString(16)}`,
  );
}
dv.setUint16(WAVE_ADDR + 0, 0, true); // type = 0 (PCM)
dv.setUint16(WAVE_ADDR + 2, 0xc0_00, true); // status = looping
dv.setUint32(WAVE_ADDR + 4, 8000, true); // freq (sample rate)
dv.setUint32(WAVE_ADDR + 8, 0, true); // loopStart
dv.setUint32(WAVE_ADDR + 0xc, WAVE_SAMPLES, true); // size
// Fill with a square wave: ±64 on s8 scale.
for (let i = 0; i < WAVE_SAMPLES; i++) {
  u8[WAVE_ADDR + 0x10 + i] = i < WAVE_SAMPLES / 2 ? 64 : (256 - 64) & 0xff;
}

// Skip MPlayJumpTableCopy + m4aSongNumStart for this probe — confirm
// maxChans survives between initAudio and the channel arming.
console.log(
  `after initAudio: maxChans=${String(u8[gSIAddr + SI.maxChans])} ` +
    `masterVolume=${String(u8[gSIAddr + SI.masterVolume])}`,
);

// Dump SoundInfo header to see what SoundInit + initAudio set up.
console.log("SoundInfo header (first 0x50 bytes):");
for (let i = 0; i < 0x50; i += 4) {
  console.log(
    `  +0x${i.toString(16).padStart(2, "0")}: 0x${dv
      .getUint32(gSIAddr + i, true)
      .toString(16)
      .padStart(8, "0")}`,
  );
}

// Arm SoundChannel 0 inside gSoundInfo.chans (offset SI.chans).
const chan0 = gSIAddr + SI.chans + 0 * 0x40;
// Clear it first.
for (let i = 0; i < 0x40; i++) u8[chan0 + i] = 0;
// Status: SF_START | SF_STOP | ENV_ATTACK
dv.setUint8(
  chan0 + SC.statusFlags,
  SC_SF_START | SC_SF_STOP | SC_SF_ENV_ATTACK,
);
dv.setUint8(chan0 + SC.type, 0); // direct sound
dv.setUint8(chan0 + SC.rightVolume, 127);
dv.setUint8(chan0 + SC.leftVolume, 127);
dv.setUint8(chan0 + SC.attack, 0xff); // instant attack
dv.setUint8(chan0 + SC.decay, 0);
dv.setUint8(chan0 + SC.sustain, 0xff);
dv.setUint8(chan0 + SC.release, 0);
dv.setUint8(chan0 + SC.envelopeVolume, 0);
dv.setUint8(chan0 + SC.envelopeVolumeRight, 127);
dv.setUint8(chan0 + SC.envelopeVolumeLeft, 127);
dv.setUint32(chan0 + SC.wav, WAVE_ADDR, true);
dv.setUint32(chan0 + SC.frequency, 440 << 10, true); // Q10 fixed ~440 Hz
dv.setUint32(chan0 + SC.count, 0, true);
dv.setUint8(chan0 + SC.midiKey, 69);
dv.setUint8(chan0 + SC.velocity, 127);
dv.setUint8(chan0 + SC.priority, 100);

// gSoundInfo.maxChans defaults to 0 unless set — make sure the mixer iterates.
dv.setUint8(gSIAddr + SI.maxChans, 12);
dv.setUint8(gSIAddr + SI.masterVolume, 15); // 0..15 master
dv.setUint8(gSIAddr + SI.pcmDmaPeriod, 7); // standard period

let maxAbs = 0;
let drains = 0;
emulator.onAudio((pcm) => {
  drains += 1;
  for (const sample of pcm.pcm) {
    const v = Math.abs((sample << 24) >> 24);
    if (v > maxAbs) maxAbs = v;
  }
});

// Get SoundMainRAM_Buffer address (separate from gSoundInfo).
const soundBuf = rawExports.SoundMainRAM_Buffer;
let soundBufAddr = 0;
if (soundBuf instanceof WebAssembly.Global) {
  const raw: unknown = soundBuf.value;
  if (typeof raw === "number") soundBufAddr = raw;
}
console.log(
  `gSoundInfo=0x${gSIAddr.toString(16)}, SoundMainRAM_Buffer=0x${soundBufAddr.toString(16)}`,
);

// Try the various sound entry points directly to see which actually writes
// to SoundMainRAM_Buffer.
const candidates = ["SoundMain", "SoundMainBTM", "m4aSoundMain"];
function rmsAt(base: number, len: number): number {
  let acc = 0;
  for (let i = 0; i < len; i++) {
    const v = (u8[base + i] << 24) >> 24;
    acc += v * v;
  }
  return Math.sqrt(acc / len);
}
// Read SOUND_INFO_PTR at 0x3007FF0 (IWRAM addr, GBA-mapped). If this doesn't
// match gSoundInfo, the mixer is using a different struct.
console.log(
  `SOUND_INFO_PTR @0x3007FF0: 0x${dv.getUint32(0x3_00_7f_f0, true).toString(16)} ` +
    `(want gSoundInfo=0x${gSIAddr.toString(16)})`,
);

// Search all of linear memory for a u32 == gSIAddr — find every pointer
// alias to gSoundInfo. The wasm mixer probably reads from one of these.
const found: number[] = [];
for (let i = 0; i < u8.byteLength - 4; i += 4) {
  if (dv.getUint32(i, true) === gSIAddr) {
    found.push(i);
    if (found.length > 8) break;
  }
}
console.log(
  `gSoundInfo address found at ${String(found.length)} location(s): ` +
    found.map((a) => `0x${a.toString(16)}`).join(", "),
);

// Also look for any address that contains "Smsh" magic ID — every SoundInfo
// struct after init has this at offset 0.
const idMagic = 0x68_73_6d_53;
const idFound: number[] = [];
for (let i = 0; i < u8.byteLength - 4; i += 4) {
  if (dv.getUint32(i, true) === idMagic) {
    idFound.push(i);
    if (idFound.length > 8) break;
  }
}
console.log(
  `Smsh ID magic found at ${String(idFound.length)} location(s): ` +
    idFound.map((a) => `0x${a.toString(16)}`).join(", "),
);

// Try writing our gSoundInfo address into the IWRAM-mapped SOUND_INFO_PTR
// slot at 0x03007FF0 — the standard GBA location where m4a assembly reads
// the pointer from.
dv.setUint32(0x3_00_7f_f0, gSIAddr, true);
console.log(
  `wrote 0x${gSIAddr.toString(16)} -> *0x3007FF0 (was 0x0). Now: 0x${dv.getUint32(0x3_00_7f_f0, true).toString(16)}`,
);

// Full-memory diff: snapshot all u8s, call SoundMain, find what changed.
function findDiffs(): { addr: number; before: number; after: number }[] {
  const before = [...u8];
  const fn = rawExports.SoundMain;
  if (typeof fn !== "function") return [];
  Reflect.apply(fn, undefined, []);
  const out: { addr: number; before: number; after: number }[] = [];
  for (const [i, element] of before.entries()) {
    if (element !== u8[i]) {
      out.push({ addr: i, before: element, after: u8[i] });
      if (out.length > 30) return out;
    }
  }
  return out;
}
const diffs = findDiffs();
console.log(`SoundMain modified ${String(diffs.length)} bytes:`);
for (const { addr, before, after } of diffs.slice(0, 20)) {
  console.log(
    `  0x${addr.toString(16)}: 0x${before.toString(16).padStart(2, "0")} -> 0x${after.toString(16).padStart(2, "0")}`,
  );
}
if (diffs.length === 0) {
  console.log("  (no memory changes — mixer did nothing)");
}

for (const name of candidates) {
  // Clear both buffer candidates.
  for (let i = 0; i < 3168; i++) {
    u8[soundBufAddr + i] = 0;
    u8[gSIAddr + 0x50 + 12 * 0x40 + i] = 0;
  }
  const fn = rawExports[name];
  if (typeof fn !== "function") continue;
  for (let i = 0; i < 5; i++) Reflect.apply(fn, undefined, []);
  console.log(
    `${name} ×5: SoundMainRAM_Buffer RMS=${rmsAt(soundBufAddr, 1584).toFixed(2)}, ` +
      `gSI.pcmBuffer RMS=${rmsAt(gSIAddr + 0x50 + 12 * 0x40, 1584).toFixed(2)}, ` +
      `chan0.envelopeVolume=${String(u8[chan0 + SC.envelopeVolume])}`,
  );
}

emulator.start();
await new Promise<void>((r) => setTimeout(r, 2000));
emulator.stop();

console.log(`drains=${String(drains)}, maxAbs=${String(maxAbs)}`);
console.log(
  `gSoundInfo.maxChans=${String(dv.getUint8(gSIAddr + SI.maxChans))}, ` +
    `chan0.statusFlags=0x${dv.getUint8(chan0 + SC.statusFlags).toString(16)}, ` +
    `chan0.envelopeVolume=${String(dv.getUint8(chan0 + SC.envelopeVolume))}`,
);
