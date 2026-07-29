import { describe, expect, it } from "bun:test";
import { LatestFrameSink } from "./latest-frame-sink.ts";

const FRAME_BYTES = 4;

function frame(value: number): Buffer {
  return Buffer.alloc(FRAME_BYTES, value);
}

describe("LatestFrameSink", () => {
  it("keeps the newest bounded window when the consumer is stalled", async () => {
    let evicted = 0;
    let delivered = 0;
    const evictedMetadata: number[] = [];
    const deliveredMetadata: number[] = [];
    const sink = new LatestFrameSink<number>({
      frameBytes: FRAME_BYTES,
      maxBufferedFrames: 3,
      onFrameEvicted: (metadata) => {
        evicted++;
        if (metadata !== undefined) evictedMetadata.push(metadata);
      },
      onFrameDelivered: (metadata) => {
        delivered++;
        if (metadata !== undefined) deliveredMetadata.push(metadata);
      },
    });

    expect(sink.writeFrame(frame(1), 1)).toBe(true);
    expect(sink.writeFrame(frame(2), 2)).toBe(true);
    expect(sink.writeFrame(frame(3), 3)).toBe(true);
    expect(sink.writeFrame(frame(4), 4)).toBe(false);
    expect(sink.bufferedBytes).toBe(FRAME_BYTES * 3);

    sink.end();
    const received: number[] = [];
    for await (const chunk of sink) {
      if (!Buffer.isBuffer(chunk)) {
        throw new TypeError("rawvideo stream emitted a non-Buffer chunk");
      }
      for (let offset = 0; offset < chunk.length; offset += FRAME_BYTES) {
        received.push(chunk[offset] ?? -1);
      }
    }

    expect(received).toEqual([2, 3, 4]);
    expect(evicted).toBe(1);
    expect(delivered).toBe(3);
    expect(evictedMetadata).toEqual([1]);
    expect(deliveredMetadata).toEqual([2, 3, 4]);
  });

  it("rejects malformed frame sizes", () => {
    let callbackCount = 0;
    const sink = new LatestFrameSink({
      frameBytes: FRAME_BYTES,
      maxBufferedFrames: 3,
      onFrameEvicted: () => {
        callbackCount++;
      },
      onFrameDelivered: () => {
        callbackCount++;
      },
    });

    expect(() => sink.write(Buffer.alloc(FRAME_BYTES - 1))).toThrow(
      "invalid rawvideo frame size",
    );
    expect(callbackCount).toBe(0);
    sink.destroy();
  });

  it("rejects writes after end", () => {
    let callbackCount = 0;
    const sink = new LatestFrameSink({
      frameBytes: FRAME_BYTES,
      maxBufferedFrames: 3,
      onFrameEvicted: () => {
        callbackCount++;
      },
      onFrameDelivered: () => {
        callbackCount++;
      },
    });
    sink.end();

    expect(() => sink.write(frame(1))).toThrow(
      "cannot write a frame after the sink has ended",
    );
    expect(callbackCount).toBe(0);
  });
});
