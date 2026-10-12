// What the game (the native SpaghettiKart port, spaghetti-src/) produces, as
// the host bridge delivers it.

// Frames: 640x480 BGRA with square pixels, top row first. The bridge pins the
// window to this size (HostBridge_ConfigureEngine).
export const WIDTH = 640;
export const HEIGHT = 480;

// Game logic runs at 30 Hz. Output is 30 fps, or 60 with the port's
// interpolated frames ([spaghettikart] output_fps).
export const GAME_FPS = 30;

// MK64's picture is 4:3. The Go-Live stream letterboxes it onto a 16:9 canvas.
export const DISPLAY_ASPECT = 4 / 3;

// Audio: interleaved s16le stereo at the port's mixer rate
// (HOST_BRIDGE_AUDIO_RATE in spaghetti-src). ffmpeg resamples for Opus.
export const AUDIO_SAMPLE_RATE = 26_800;
export const AUDIO_CHANNELS = 2;

/** Every controller button, in a fixed order for per-frame scans. */
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
export const MAX_SEATS = 4;
