import { VI_TICKS_PER_VIDEO_FRAME } from "#src/emulator/vi-timing.ts";

// Keep roughly 100 ms of Worker-to-main jitter headroom at 30 output fps.
export const MAX_FRAMES_IN_FLIGHT = 3;

// Audio is emitted once per VI while video is emitted every second VI. Give
// audio one leading VI beyond the equivalent three-frame window: on even VIs
// the video callback runs before audio, so the fourth frame is not rejected
// until after the seventh audio chunk would otherwise have been rejected.
export const MAX_AUDIO_IN_FLIGHT =
  MAX_FRAMES_IN_FLIGHT * VI_TICKS_PER_VIDEO_FRAME + 1;
