// Byte offsets + typed accessors for the GBA m4a (Sappy / MusicPlayer 2000)
// runtime structs. The wasm exports `gSoundInfo`, `gMPlayInfo_BGM`, etc. as
// linear-memory globals; handler code in this directory walks those structs at
// the offsets below to mirror the behavior of the ARM-assembly m4a handlers
// that the wasm imports as functions.
//
// Source of truth: pret/pokeemerald include/gba/m4a_internal.h (master).
// Offsets derived by hand from the C struct definitions assuming standard
// natural alignment (32-bit pointers, no packing) — emscripten matches devkit
// ARM's layout for these structs.

export const MUSIC_PLAYER_TRACK_SIZE = 0x50;
export const MUSIC_PLAYER_INFO_SIZE = 0x40;
export const SOUND_CHANNEL_SIZE = 0x40;
export const TONE_DATA_SIZE = 0x0c;
export const WAVE_DATA_HEADER_SIZE = 0x10;
export const SOUND_INFO_HEADER_SIZE = 0x50;
export const PCM_DMA_BUF_SIZE = 1584;

// MusicPlayerTrack — see m4a_internal.h:272
export const MPT = {
  flags: 0x00,
  wait: 0x01,
  patternLevel: 0x02,
  repN: 0x03,
  gateTime: 0x04,
  key: 0x05,
  velocity: 0x06,
  runningStatus: 0x07,
  keyM: 0x08,
  pitM: 0x09,
  keyShift: 0x0a,
  keyShiftX: 0x0b,
  tune: 0x0c,
  pitX: 0x0d,
  bend: 0x0e,
  bendRange: 0x0f,
  volMR: 0x10,
  volML: 0x11,
  vol: 0x12,
  volX: 0x13,
  pan: 0x14,
  panX: 0x15,
  modM: 0x16,
  mod: 0x17,
  modT: 0x18,
  lfoSpeed: 0x19,
  lfoSpeedC: 0x1a,
  lfoDelay: 0x1b,
  lfoDelayC: 0x1c,
  priority: 0x1d,
  pseudoEchoVolume: 0x1e,
  pseudoEchoLength: 0x1f,
  chan: 0x20,
  tone: 0x24,
  timer: 0x3a,
  unk_3C: 0x3c,
  cmdPtr: 0x40,
  patternStack: 0x44,
} as const;

// ToneData embedded in MusicPlayerTrack at MPT.tone — see m4a_internal.h:57
export const TONE = {
  type: 0x00,
  key: 0x01,
  length: 0x02,
  pan_sweep: 0x03,
  wav: 0x04,
  attack: 0x08,
  decay: 0x09,
  sustain: 0x0a,
  release: 0x0b,
} as const;

// MusicPlayerInfo — see m4a_internal.h:327
export const MPI = {
  songHeader: 0x00,
  status: 0x04,
  trackCount: 0x08,
  priority: 0x09,
  cmd: 0x0a,
  unk_B: 0x0b,
  clock: 0x0c,
  memAccArea: 0x18,
  tempoD: 0x1c,
  tempoU: 0x1e,
  tempoI: 0x20,
  tempoC: 0x22,
  fadeOI: 0x24,
  fadeOC: 0x26,
  fadeOV: 0x28,
  tracks: 0x2c,
  tone: 0x30,
  ident: 0x34,
  MPlayMainNext: 0x38,
  musicPlayerNext: 0x3c,
} as const;

// SoundInfo — see m4a_internal.h:185
export const SI = {
  ident: 0x00,
  pcmDmaCounter: 0x04,
  reverb: 0x05,
  maxChans: 0x06,
  masterVolume: 0x07,
  freq: 0x08,
  mode: 0x09,
  c15: 0x0a,
  pcmDmaPeriod: 0x0b,
  maxLines: 0x0c,
  pcmSamplesPerVBlank: 0x10,
  pcmFreq: 0x14,
  divFreq: 0x18,
  cgbChans: 0x1c,
  MPlayMainHead: 0x20,
  musicPlayerHead: 0x24,
  CgbSound: 0x28,
  CgbOscOff: 0x2c,
  MidiKeyToCgbFreq: 0x30,
  MPlayJumpTable: 0x34,
  plynote: 0x38,
  ExtVolPit: 0x3c,
  chans: 0x50,
  // pcmBuffer follows the 12 SoundChannel slots
  pcmBuffer: 0x50 + 12 * SOUND_CHANNEL_SIZE,
} as const;

// SoundChannel — see m4a_internal.h:130
export const SC = {
  statusFlags: 0x00,
  type: 0x01,
  rightVolume: 0x02,
  leftVolume: 0x03,
  attack: 0x04,
  decay: 0x05,
  sustain: 0x06,
  release: 0x07,
  key: 0x08,
  envelopeVolume: 0x09,
  envelopeVolumeRight: 0x0a,
  envelopeVolumeLeft: 0x0b,
  pseudoEchoVolume: 0x0c,
  pseudoEchoLength: 0x0d,
  gateTime: 0x10,
  midiKey: 0x11,
  velocity: 0x12,
  priority: 0x13,
  rhythmPan: 0x14,
  count: 0x18,
  fw: 0x1c,
  frequency: 0x20,
  wav: 0x24,
  currentPointer: 0x28,
  track: 0x2c,
  prevChannelPointer: 0x30,
  nextChannelPointer: 0x34,
  xpi: 0x3c,
  xpc: 0x3e,
} as const;

// WaveData — see m4a_internal.h:39
export const WD = {
  type: 0x00,
  status: 0x02,
  freq: 0x04,
  loopStart: 0x08,
  size: 0x0c,
  data: 0x10,
} as const;

// PokemonCrySong — see m4a_internal.h:233
export const PCS = {
  trackCount: 0x00,
  blockCount: 0x01,
  priority: 0x02,
  reverb: 0x03,
  tone: 0x04,
  part0Ptr: 0x08,
  part1Ptr: 0x0c,
  gap: 0x10,
  part0: 0x11,
  tuneValue: 0x12,
  gotoCmd: 0x13,
  gotoTarget: 0x14,
  part1: 0x18,
  tuneValue2: 0x19,
  cont: 0x1a,
  volCmd: 0x1c,
  volumeValue: 0x1d,
  unkCmd0D: 0x1e,
  unkCmd0DParam: 0x20,
  xreleCmd: 0x24,
  releaseValue: 0x26,
  panCmd: 0x27,
  panValue: 0x28,
  tieCmd: 0x29,
  tieKeyValue: 0x2a,
  tieVelocityValue: 0x2b,
  xwaitCmd: 0x2c,
  length: 0x2e,
  end: 0x30,
} as const;

// Status-flag bits — see m4a_internal.h:265
export const MPT_FLG_VOLSET = 0x01;
export const MPT_FLG_VOLCHG = 0x03;
export const MPT_FLG_PITSET = 0x04;
export const MPT_FLG_PITCHG = 0x0c;
export const MPT_FLG_START = 0x40;
export const MPT_FLG_EXIST = 0x80;

// Center value for PAN, BEND, and TUNE — see m4a_internal.h:10.
export const C_V = 0x40;
