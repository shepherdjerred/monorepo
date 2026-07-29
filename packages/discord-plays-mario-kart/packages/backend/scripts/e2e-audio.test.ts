import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { waitForVideoDrain } from "./e2e-audio.ts";

test("reports encoder failure while video is waiting for drain", async () => {
  const video = new PassThrough({ highWaterMark: 1 });
  expect(video.write(Buffer.alloc(2))).toBe(false);

  const encoderFailure = Promise.reject(new Error("encoder unavailable"));
  await expect(waitForVideoDrain(video, encoderFailure)).rejects.toThrow(
    "encoder unavailable",
  );
  video.destroy();
});

test("rejects when the encoder exits before video drains", async () => {
  const video = new PassThrough({ highWaterMark: 1 });
  expect(video.write(Buffer.alloc(2))).toBe(false);

  await expect(waitForVideoDrain(video, Promise.resolve())).rejects.toThrow(
    "ffmpeg exited before video input completed",
  );
  video.destroy();
});
