import { expect, test } from "bun:test";
import { VI_TICKS_PER_VIDEO_FRAME } from "#src/emulator/vi-timing.ts";
import { MAX_AUDIO_IN_FLIGHT, MAX_FRAMES_IN_FLIGHT } from "./backpressure.ts";

test("gives audio and video equal in-flight duration headroom", () => {
  expect(MAX_FRAMES_IN_FLIGHT).toBe(3);
  expect(MAX_AUDIO_IN_FLIGHT).toBe(
    MAX_FRAMES_IN_FLIGHT * VI_TICKS_PER_VIDEO_FRAME,
  );
});
