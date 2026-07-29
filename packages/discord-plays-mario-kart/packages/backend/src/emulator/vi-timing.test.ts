import { expect, test } from "bun:test";
import {
  shouldEmitVideoFrame,
  viIntervalMs,
  VI_TICKS_PER_VIDEO_FRAME,
} from "./vi-timing.ts";

test("paces two N64 vertical interrupts per MK64 video frame", () => {
  expect(VI_TICKS_PER_VIDEO_FRAME).toBe(2);
  expect(viIntervalMs(30)).toBeCloseTo(1000 / 60);
  expect(
    [1, 2, 3, 4].filter((completedViTicks) =>
      shouldEmitVideoFrame(completedViTicks),
    ),
  ).toEqual([2, 4]);
});
