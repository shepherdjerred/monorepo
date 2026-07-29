import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { waitForCalibrationVideoDrain } from "./e2e-stream-latency.ts";

test("reports an encoder failure instead of waiting forever for video drain", async () => {
  const video = new PassThrough({ highWaterMark: 1 });
  const failure = new Error("encoder failed");

  await expect(
    waitForCalibrationVideoDrain(video, Promise.reject(failure)),
  ).rejects.toThrow("encoder failed");
  video.destroy();
});

test("reports a clean early encoder exit before video drain", async () => {
  const video = new PassThrough({ highWaterMark: 1 });

  await expect(
    waitForCalibrationVideoDrain(video, Promise.resolve()),
  ).rejects.toThrow("ffmpeg exited before calibration video input completed");
  video.destroy();
});
