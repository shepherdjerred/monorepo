import { describe, expect, it } from "bun:test";
import {
  createFrameSink,
  MAX_SINK_BUFFER_BYTES,
  MIN_AUDIO_PREROLL_BYTES,
  shouldPauseForEncoderBackpressure,
} from "./game-streamer.ts";
import { HEIGHT, WIDTH } from "#src/emulator/constants.ts";

const FRAME_BYTES = WIDTH * HEIGHT * 4;

describe("createFrameSink", () => {
  it("budgets roughly three frames of queue", () => {
    expect(MAX_SINK_BUFFER_BYTES).toBe(FRAME_BYTES * 3);
  });

  it("signals backpressure at a bounded backlog without dropping a frame", () => {
    // A sink nobody reads from models ffmpeg startup or a stalled encoder. Stop
    // producing on write()=false, exactly as GameStreamer pauses the emulator.
    const sink = createFrameSink();
    const frame = Buffer.alloc(FRAME_BYTES);
    let written = 0;
    let canContinue = true;

    while (canContinue) {
      canContinue = sink.write(frame);
      written++;
    }

    expect(written).toBeGreaterThan(1);
    expect(written).toBeLessThanOrEqual(6);
    expect(sink.writableLength).toBeLessThanOrEqual(MAX_SINK_BUFFER_BYTES);
    sink.destroy();
  });

  it("emits drain after a stalled sink starts consuming", async () => {
    const sink = createFrameSink();
    const frame = Buffer.alloc(FRAME_BYTES);
    let canContinue = true;
    while (canContinue) canContinue = sink.write(frame);

    const drained = new Promise<void>((resolve) => {
      sink.once("drain", resolve);
    });
    sink.resume();
    await drained;

    expect(sink.writableLength).toBe(0);
    sink.destroy();
  });
});

describe("shouldPauseForEncoderBackpressure", () => {
  it("does not pause before the live PCM input has enough startup data", () => {
    expect(shouldPauseForEncoderBackpressure(false, 0)).toBe(false);
    expect(
      shouldPauseForEncoderBackpressure(false, MIN_AUDIO_PREROLL_BYTES - 1),
    ).toBe(false);
  });

  it("pauses a full video sink once one second of PCM has been forwarded", () => {
    expect(
      shouldPauseForEncoderBackpressure(false, MIN_AUDIO_PREROLL_BYTES),
    ).toBe(true);
  });

  it("keeps running when the video sink is accepting data", () => {
    expect(
      shouldPauseForEncoderBackpressure(true, MIN_AUDIO_PREROLL_BYTES),
    ).toBe(false);
  });
});
