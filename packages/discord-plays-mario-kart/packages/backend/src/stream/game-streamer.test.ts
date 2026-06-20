import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { MAX_SINK_BUFFER_BYTES, shouldDropFrame } from "./game-streamer.ts";
import { HEIGHT, WIDTH } from "#src/emulator/constants.ts";

const FRAME_BYTES = WIDTH * HEIGHT * 4;

describe("shouldDropFrame", () => {
  it("budgets roughly three frames of queue", () => {
    expect(MAX_SINK_BUFFER_BYTES).toBe(FRAME_BYTES * 3);
  });

  it("keeps frames while the queue is under budget", () => {
    expect(shouldDropFrame(0)).toBe(false);
    expect(shouldDropFrame(FRAME_BYTES)).toBe(false);
    expect(shouldDropFrame(MAX_SINK_BUFFER_BYTES - 1)).toBe(false);
  });

  it("drops once the queue reaches the budget", () => {
    expect(shouldDropFrame(MAX_SINK_BUFFER_BYTES)).toBe(true);
    expect(shouldDropFrame(MAX_SINK_BUFFER_BYTES + FRAME_BYTES)).toBe(true);
  });
});

describe("bounded frame queue under a stalled consumer", () => {
  it("caps the PassThrough backlog near the latency budget instead of growing unbounded", () => {
    // A PassThrough nobody reads from models a stalled ffmpeg/Discord consumer.
    // Without the drop gate this grows without bound (the 3.5 GB / ~3 min backlog
    // seen in prod); with it the queue stays near the budget and frames are dropped.
    const sink = new PassThrough();
    const frame = Buffer.alloc(FRAME_BYTES);
    let written = 0;
    let dropped = 0;

    for (let i = 0; i < 1000; i++) {
      if (shouldDropFrame(sink.writableLength)) {
        dropped++;
        continue;
      }
      sink.write(frame);
      written++;
    }

    expect(dropped).toBeGreaterThan(0);
    expect(written).toBeGreaterThan(0);
    // Never more than the budget plus the single in-flight frame that tipped it over.
    expect(sink.writableLength).toBeLessThanOrEqual(
      MAX_SINK_BUFFER_BYTES + FRAME_BYTES,
    );
  });
});
