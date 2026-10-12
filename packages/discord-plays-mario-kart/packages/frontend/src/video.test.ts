import { describe, expect, it } from "vitest";
import {
  DRIVER_FEED_AUDIO_FLAG,
  DRIVER_FEED_KEYFRAME_FLAG,
} from "@discord-plays-mario-kart/common";
import {
  decideDriverFeedDecode,
  isDriverFeedAudio,
  retainDriverFeedEntryPoint,
  shouldPaintDriverFeedOutput,
} from "./video.ts";

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
        decodeQueueSize: 6,
      }),
    ).toEqual({ reset: true, decode: false, nextStarted: false });
  });

  it("decodes through a short burst instead of blanking until a keyframe", () => {
    // Three units released at once by a TCP stall must not cost a ~1 s freeze.
    expect(
      decideDriverFeedDecode({
        started: true,
        isKeyframe: false,
        decodeQueueSize: 3,
      }),
    ).toEqual({ reset: false, decode: true, nextStarted: true });
  });

  it("can restart immediately when the backlog is detected on a keyframe", () => {
    expect(
      decideDriverFeedDecode({
        started: true,
        isKeyframe: true,
        decodeQueueSize: 6,
      }),
    ).toEqual({ reset: true, decode: true, nextStarted: true });
  });
});

describe("shouldPaintDriverFeedOutput", () => {
  it("paints a frame with nothing newer behind it", () => {
    expect(shouldPaintDriverFeedOutput(0)).toBe(true);
    expect(shouldPaintDriverFeedOutput(1)).toBe(true);
  });

  it("skips frames a draining burst is about to overwrite", () => {
    expect(shouldPaintDriverFeedOutput(2)).toBe(false);
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

describe("isDriverFeedAudio", () => {
  it("recognises audio chunks", () => {
    expect(isDriverFeedAudio(encodedUnit(DRIVER_FEED_AUDIO_FLAG))).toBe(true);
  });

  it("leaves video units, keyframe or not, to the decoder", () => {
    expect(isDriverFeedAudio(encodedUnit(0))).toBe(false);
    expect(isDriverFeedAudio(encodedUnit(DRIVER_FEED_KEYFRAME_FLAG))).toBe(
      false,
    );
  });

  it("ignores a header with no payload", () => {
    expect(
      isDriverFeedAudio(Uint8Array.from([DRIVER_FEED_AUDIO_FLAG]).buffer),
    ).toBe(false);
  });
});
