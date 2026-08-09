import { describe, expect, it } from "bun:test";
import { DRIVER_FEED_KEYFRAME_FLAG } from "@discord-plays-mario-kart/common";
import { decideDriverFeedDecode, retainDriverFeedEntryPoint } from "./video.ts";

function encodedUnit(flags: number): ArrayBuffer {
  return Uint8Array.from([flags, 1]).buffer;
}

describe("decideDriverFeedDecode", () => {
  it("waits for a keyframe when the decoder has not started", () => {
    expect(
      decideDriverFeedDecode({
        started: false,
        isKeyframe: false,
        decodeQueueSize: 0,
      }),
    ).toEqual({ reset: false, decode: false, nextStarted: false });
  });

  it("starts at a keyframe", () => {
    expect(
      decideDriverFeedDecode({
        started: false,
        isKeyframe: true,
        decodeQueueSize: 0,
      }),
    ).toEqual({ reset: false, decode: true, nextStarted: true });
  });

  it("resets a backlogged decoder and drops deltas until a keyframe", () => {
    expect(
      decideDriverFeedDecode({
        started: true,
        isKeyframe: false,
        decodeQueueSize: 2,
      }),
    ).toEqual({ reset: true, decode: false, nextStarted: false });
  });

  it("accepts one more delta while the decoder remains below its bound", () => {
    expect(
      decideDriverFeedDecode({
        started: true,
        isKeyframe: false,
        decodeQueueSize: 1,
      }),
    ).toEqual({ reset: false, decode: true, nextStarted: true });
  });

  it("can restart immediately when the backlog is detected on a keyframe", () => {
    expect(
      decideDriverFeedDecode({
        started: true,
        isKeyframe: true,
        decodeQueueSize: 2,
      }),
    ).toEqual({ reset: true, decode: true, nextStarted: true });
  });
});

describe("retainDriverFeedEntryPoint", () => {
  it("ignores deltas while decoder configuration is pending", () => {
    expect(
      retainDriverFeedEntryPoint(undefined, encodedUnit(0)),
    ).toBeUndefined();
  });

  it("preserves the first keyframe while decoder configuration is pending", () => {
    const first = encodedUnit(DRIVER_FEED_KEYFRAME_FLAG);
    const later = encodedUnit(DRIVER_FEED_KEYFRAME_FLAG);

    expect(retainDriverFeedEntryPoint(undefined, first)).toBe(first);
    expect(retainDriverFeedEntryPoint(first, later)).toBe(first);
  });
});
