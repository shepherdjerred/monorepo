import { describe, expect, it } from "bun:test";
import {
  createFrameSink,
  EncoderFlowControl,
  MAX_SINK_BUFFER_BYTES,
  MIN_AUDIO_PREROLL_BYTES,
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

describe("EncoderFlowControl", () => {
  it("does not pause before the live PCM input has enough startup data", () => {
    const flow = new EncoderFlowControl();
    expect(flow.onVideoWrite(false)).toEqual({
      action: undefined,
      watchDrain: true,
    });
    flow.onAudio(MIN_AUDIO_PREROLL_BYTES - 1);
    expect(flow.onVideoWrite(false)).toEqual({
      action: undefined,
      watchDrain: false,
    });
  });

  it("pauses a full video sink once one second of PCM has been forwarded", () => {
    const flow = new EncoderFlowControl();
    flow.onAudio(MIN_AUDIO_PREROLL_BYTES);
    expect(flow.onVideoWrite(false)).toEqual({
      action: "pause",
      watchDrain: true,
    });
  });

  it("keeps running when the video sink is accepting data", () => {
    const flow = new EncoderFlowControl();
    flow.onAudio(MIN_AUDIO_PREROLL_BYTES);
    expect(flow.onVideoWrite(true)).toEqual({
      action: undefined,
      watchDrain: false,
    });
  });

  it("uses first encoder progress to release startup, then waits for drain to re-arm", () => {
    const flow = new EncoderFlowControl();
    expect(flow.onVideoWrite(false)).toEqual({
      action: undefined,
      watchDrain: true,
    });
    expect(flow.onProgress()).toBeUndefined();
    flow.onAudio(MIN_AUDIO_PREROLL_BYTES);
    expect(flow.onVideoWrite(false)).toEqual({
      action: undefined,
      watchDrain: false,
    });
    expect(flow.onProgress()).toBeUndefined();
    expect(flow.onDrain()).toBeUndefined();
    expect(flow.onVideoWrite(false)).toEqual({
      action: "pause",
      watchDrain: true,
    });
    expect(flow.onProgress()).toBeUndefined();
    expect(flow.onDrain()).toBe("resume");
  });

  it("resumes an audio-ready startup pause when encoder progress arrives", () => {
    const flow = new EncoderFlowControl();
    flow.onAudio(MIN_AUDIO_PREROLL_BYTES);
    expect(flow.onVideoWrite(false).action).toBe("pause");
    expect(flow.onProgress()).toBe("resume");
  });

  it("resumes a paused emulator when stream state resets", () => {
    const flow = new EncoderFlowControl();
    flow.onAudio(MIN_AUDIO_PREROLL_BYTES);
    expect(flow.onVideoWrite(false).action).toBe("pause");
    expect(flow.reset()).toBe("resume");
    expect(flow.onVideoWrite(false)).toEqual({
      action: undefined,
      watchDrain: true,
    });
  });
});
