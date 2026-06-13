// N64Wasm (parallel-n64 + angrylion) headless host constants.
//
// The angrylion software renderer writes a 640 x angryVerticalResolution RGBA
// framebuffer; height is read at runtime via _neilGetVideoHeight() (≈240 for
// MK64's 320x240 doubled). WIDTH is fixed at 640.
export const WIDTH = 640;
// Default/streaming height. The real height comes from emu.height; this is the
// value the stream pipeline is sized for (MK64 NTSC).
export const HEIGHT = 240;

// MK64 displays ~30fps; we step the emulator at this rate (8.3ms/frame in the
// spike → ~3x headroom). Overridable via config.emulator.fps.
export const N64_FPS = 30;

// MK64's native framebuffer is 640x240 (a horizontally-doubled 320x240), which
// displays at 4:3. We letterbox this onto a 16:9 canvas for Discord, so the
// stream uses the *display* aspect, not the raw 640:240 pixel aspect.
export const DISPLAY_ASPECT = 4 / 3;

// The per-player controls string passed to neil_send_mobile_controls_player:
// 14 chars, '0'/'1', in this exact order (must match mymain.cpp).
export const CONTROL_CHARS = 14;
export const BUTTON_ORDER = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "start",
  "z",
  "l",
  "r",
  "cUp",
  "cDown",
  "cLeft",
  "cRight",
] as const;
export type N64Button = (typeof BUTTON_ORDER)[number];

export const MAX_SEATS = 4;
