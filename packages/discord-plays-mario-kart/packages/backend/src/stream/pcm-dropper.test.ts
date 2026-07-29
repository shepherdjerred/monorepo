import { describe, expect, it } from "bun:test";
import {
  AUDIO_BLOCK_ALIGN,
  AUDIO_BYTES_PER_VIDEO_FRAME,
} from "#src/emulator/constants.ts";
import { PcmDropper } from "./pcm-dropper.ts";

describe("PcmDropper", () => {
  it("derives one exact 30 fps frame of stereo PCM", () => {
    expect(AUDIO_BYTES_PER_VIDEO_FRAME).toBe(5880);
    expect(AUDIO_BYTES_PER_VIDEO_FRAME % AUDIO_BLOCK_ALIGN).toBe(0);
  });

  it("returns the original chunk when no drop is scheduled", () => {
    const dropper = new PcmDropper(AUDIO_BLOCK_ALIGN);
    const pcm = Buffer.from([0, 1, 2, 3]);

    expect(dropper.process(pcm)).toBe(pcm);
  });

  it("consumes a drop debt across chunk boundaries", () => {
    const dropper = new PcmDropper(AUDIO_BLOCK_ALIGN);
    dropper.dropNext(12);

    expect(dropper.process(Buffer.alloc(8, 0x11))).toHaveLength(0);
    expect(dropper.process(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))).toEqual(
      Buffer.from([4, 5, 6, 7]),
    );
  });

  it("keeps accepted video duration equal to forwarded PCM duration", () => {
    const dropper = new PcmDropper(AUDIO_BLOCK_ALIGN);
    const halfFramePcm = Buffer.alloc(AUDIO_BYTES_PER_VIDEO_FRAME / 2);
    let forwardedBytes = 0;
    let acceptedFrames = 0;

    for (let frame = 0; frame < 300; frame++) {
      const dropped = frame % 7 === 0;
      if (dropped) {
        dropper.dropNext(AUDIO_BYTES_PER_VIDEO_FRAME);
      } else {
        acceptedFrames++;
      }
      forwardedBytes += dropper.process(halfFramePcm).length;
      forwardedBytes += dropper.process(halfFramePcm).length;
    }

    expect(forwardedBytes).toBe(acceptedFrames * AUDIO_BYTES_PER_VIDEO_FRAME);
  });

  it("rejects sample-splitting debts and chunks", () => {
    const dropper = new PcmDropper(AUDIO_BLOCK_ALIGN);

    expect(() => dropper.dropNext(2)).toThrow(
      "scheduled PCM drop must be a non-negative multiple of 4 bytes",
    );
    expect(() => dropper.process(Buffer.alloc(6))).toThrow(
      "PCM chunk must be a non-negative multiple of 4 bytes",
    );
  });

  it("clears an outstanding debt on reset", () => {
    const dropper = new PcmDropper(AUDIO_BLOCK_ALIGN);
    const pcm = Buffer.alloc(AUDIO_BLOCK_ALIGN);
    dropper.dropNext(AUDIO_BLOCK_ALIGN);
    dropper.reset();

    expect(dropper.process(pcm)).toBe(pcm);
  });
});
