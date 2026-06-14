// GBA hardware constants. These addresses are used directly as byte offsets
// into the wasm linear memory (the wasm build maps the GBA address space 1:1),
// matching pokeemerald-wasm's web/app.js renderer.

export const WIDTH = 240;
export const HEIGHT = 160;
export const FRAME_BYTES = WIDTH * HEIGHT * 4;

// The GBA screen is 240x160 = 3:2 (square pixels). We letterbox this onto a 16:9
// canvas for Discord, so the stream uses the display aspect, pillarboxed on black.
export const DISPLAY_ASPECT = 3 / 2;

export const REG = 0x04_00_00_00;
export const PAL = 0x05_00_00_00;
export const VRAM = 0x06_00_00_00;
export const OAM = 0x07_00_00_00;
export const KEYINPUT = 0x04_00_01_30;
export const KEY_MASK = 0x03_ff;

export const FLASH_BASE = 0x0e_00_00_00;
export const FLASH_SIZE = 128 * 1024;

// GBA runs at ~59.7275 Hz.
export const GBA_FPS = 59.7275;
export const FRAME_MS = 1000 / GBA_FPS;

// m4a mixer native rate (SOUND_MODE_FREQ_13379, the Emerald default). The
// streamer hands ffmpeg raw Float32 LRLR PCM at this rate; ffmpeg resamples
// to 48 kHz for Opus.
export const AUDIO_SAMPLE_RATE = 13_379;
export const AUDIO_CHANNELS = 2;

// Button bitmask (matches KEYINPUT layout, active-low in the register).
export const BUTTON = {
  a: 1, // 1 << 0
  b: 1 << 1,
  select: 1 << 2,
  start: 1 << 3,
  right: 1 << 4,
  left: 1 << 5,
  up: 1 << 6,
  down: 1 << 7,
  r: 1 << 8,
  l: 1 << 9,
} as const;

export type ButtonName = keyof typeof BUTTON;
