// MK64 renders a new video frame every other NTSC vertical interrupt. The
// Emscripten `_runMainLoop` export advances one VI, not one rendered frame.
// Calling it only at the 30 fps display cadence therefore runs the whole game
// and its 44.1 kHz audio clock at half speed.
export const VI_TICKS_PER_VIDEO_FRAME = 2;

/** Paced-loop interval required to produce `outputFps` displayed frames. */
export function viIntervalMs(outputFps: number): number {
  return 1000 / (outputFps * VI_TICKS_PER_VIDEO_FRAME);
}

/** Whether a completed VI tick produced the next displayed video frame. */
export function shouldEmitVideoFrame(completedViTicks: number): boolean {
  return completedViTicks % VI_TICKS_PER_VIDEO_FRAME === 0;
}
