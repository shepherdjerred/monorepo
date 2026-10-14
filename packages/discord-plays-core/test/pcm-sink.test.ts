import { describe, expect, it } from "vitest";
import { PcmSink } from "#src/stream/pcm-sink.ts";

describe("bounded PCM", () => {
  it("keeps the newest window when the encoder never connects", () => {
    const sink = new PcmSink(12, 4);
    for (let value = 0; value < 1000; value++)
      sink.write(Buffer.alloc(4, value % 256));
    expect(sink.bufferedBytes).toBe(12);
    expect(sink.droppedBytes).toBe(3988);
    expect(sink.read(4)).toEqual(Buffer.alloc(4, 997 % 256));
    sink.close();
  });
  it("counts the Readable buffer and splits oversized producer batches", () => {
    const sink = new PcmSink(12, 4);
    sink.write(Buffer.alloc(4, 1));
    expect(sink.read(0)).toBeNull();
    expect(sink.readableLength).toBe(4);
    expect(sink.write(Buffer.alloc(100, 2))).toBe(false);
    expect(sink.bufferedBytes).toBeLessThanOrEqual(12);
    expect(sink.read(4)).toEqual(Buffer.alloc(4, 1));
    expect(sink.read(4)).toEqual(Buffer.alloc(4, 2));
    sink.close();
    expect(() => sink.write(Buffer.alloc(4))).toThrow("closed");
  });
});
