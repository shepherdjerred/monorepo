import { VI_TICKS_PER_VIDEO_FRAME } from "#src/emulator/vi-timing.ts";

// Keep roughly 100 ms of Worker-to-main jitter headroom at 30 output fps.
export const MAX_FRAMES_IN_FLIGHT = 3;

// Audio is emitted once per VI while video is emitted every second VI. Give
// both streams the same time-based headroom so a short main-thread stall does
// not drop PCM before the corresponding video frames.
export const MAX_AUDIO_IN_FLIGHT =
  MAX_FRAMES_IN_FLIGHT * VI_TICKS_PER_VIDEO_FRAME;
