import { describe, expect, it } from "bun:test";
import {
  createFrameSink,
  frameSinkBufferedBytes,
  MAX_SINK_BUFFER_BYTES,
  STARTUP_BUFFER_FRAMES,
  wouldExceedFrameBuffer,
} from "./game-streamer.ts";
import { HEIGHT, WIDTH } from "#src/emulator/constants.ts";

const FRAME_BYTES = WIDTH * HEIGHT * 4;

describe("createFrameSink", () => {
  it("budgets eight seconds of complete startup frames", () => {
    expect(STARTUP_BUFFER_FRAMES).toBe(240);
    expect(MAX_SINK_BUFFER_BYTES).toBe(FRAME_BYTES * STARTUP_BUFFER_FRAMES);
  });

  it("retains the measured 149-frame startup wall without backpressure", () => {
    const sink = createFrameSink();
    const frame = Buffer.alloc(FRAME_BYTES);
    for (let index = 0; index < 149; index++) {
      expect(sink.write(frame)).toBe(true);
    }
    expect(frameSinkBufferedBytes(sink)).toBe(FRAME_BYTES * 149);
    sink.destroy();
  });

  it("permits an exactly full buffer and rejects the next frame", () => {
    expect(
      wouldExceedFrameBuffer(MAX_SINK_BUFFER_BYTES - FRAME_BYTES, FRAME_BYTES),
    ).toBe(false);
    expect(wouldExceedFrameBuffer(MAX_SINK_BUFFER_BYTES, FRAME_BYTES)).toBe(
      true,
    );
  });
});
