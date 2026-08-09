import { describe, expect, it } from "bun:test";
import { decideDriverFeedDecode } from "./video.ts";

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
