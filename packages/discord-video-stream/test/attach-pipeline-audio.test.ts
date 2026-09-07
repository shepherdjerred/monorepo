import { describe, expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";

// This file is run by bun but is intentionally outside the package's tsconfig `include`, so the
// loosely-typed fakes below don't need to satisfy the real Streamer / connection types.

/**
 * The demuxer is the one dependency `attachPipeline` cannot be handed: it opens a real libav
 * context over the input. Replacing it is what lets these tests describe a source that has audio
 * and no video — the shape a music stream produces — without ffmpeg.
 */
const demuxState = vi.hoisted(() => ({ next: undefined }));

vi.mock("../src/media/LibavDemuxer.js", () => ({
  demux: () => Promise.resolve(demuxState.next),
}));

const { attachPipeline, mergePlayStreamOptions } = await import(
  "../src/media/newApi.ts"
);

/** Opus stream info as LibavDemuxer reports it, over an objectMode packet pipe we drive by hand. */
function audioTrack() {
  const stream = new PassThrough({ objectMode: true, highWaterMark: 0 });
  return { index: 1, codec: 86_076, codecpar: {}, avStream: {}, sample_rate: 48_000, stream };
}

function videoTrack() {
  const stream = new PassThrough({ objectMode: true, highWaterMark: 0 });
  return {
    index: 0,
    // AV_CODEC_ID_H264, the one branch of attachPipeline's videoCodecMap these tests need.
    codec: 27,
    codecpar: {},
    avStream: {},
    width: 1280,
    height: 720,
    framerate_num: 30,
    framerate_den: 1,
    stream,
  };
}

/**
 * Minimal structural Packet. 20 ms in a 1/1000 timebase is what LibavDemuxer produces for Opus —
 * NUT carries no per-packet duration, so every music frame's 20 ms comes from the demuxer's TOC-byte
 * fallback. `_write` only touches these five fields.
 */
function opusPacket(ptsMs: number, durationMs = 20) {
  return {
    data: new Uint8Array([0x78, 0x01, 0x02]),
    pts: BigInt(ptsMs),
    duration: BigInt(durationMs),
    timeBase: { num: 1, den: 1000 },
    free: () => {},
  };
}

function makeConn() {
  const calls = { setPacketizer: 0, setSpeaking: 0, setVideoAttributes: 0, sendAudioFrame: 0 };
  return {
    calls,
    setPacketizer: () => {
      calls.setPacketizer++;
    },
    sendAudioFrame: () => {
      calls.sendAudioFrame++;
      return true;
    },
    sendVideoFrame: () => {},
    mediaConnection: {
      setSpeaking: () => {
        calls.setSpeaking++;
      },
      setVideoAttributes: () => {
        calls.setVideoAttributes++;
      },
    },
  };
}

function makeStreamer() {
  const calls = { signalVideo: 0, createStream: 0, stopStream: 0, setStreamPreview: 0 };
  return {
    calls,
    signalVideo: () => {
      calls.signalVideo++;
    },
    createStream: () => {
      calls.createStream++;
    },
    stopStream: () => {
      calls.stopStream++;
    },
    setStreamPreview: () => {
      calls.setStreamPreview++;
      return Promise.resolve();
    },
  };
}

/** Records what the pipeline hands the transport, satisfying AudioFrameSink structurally. */
function makeSink(accepted = true) {
  const frames: { bytes: number; frametimeMs: number }[] = [];
  return {
    frames,
    sendAudioFrame: (frame: Buffer, frametimeMs: number) => {
      frames.push({ bytes: frame.length, frametimeMs });
      return accepted;
    },
  };
}

/**
 * The `AudioStream` attachPipeline built, recovered from the source's pipe list.
 *
 * attachPipeline does not return its streams, and the burst gate's whole claim is about WHICH
 * stream carries it — so the flag has to be read off the real instance. Reaching through
 * `_readableState.pipes` is the same private-state idiom `voice-audio.test.ts` uses to stand up a
 * connection; `noSleep` itself is a documented public accessor on BaseMediaStream.
 */
function pipedAudioStream(source) {
  const pipes = source._readableState?.pipes;
  const destination = Array.isArray(pipes) ? pipes[0] : pipes;
  if (destination === undefined || destination === null) {
    throw new Error("the audio source was never piped to an AudioStream");
  }
  return destination;
}

/**
 * Poll until `condition` holds. The deadline is a failure guard, not the assertion — every
 * expectation in this file is on observed state, never on how long something took.
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${String(timeoutMs)}ms waiting for the pipeline`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * Parameter types taken from the functions themselves rather than asserted away. A fake that has
 * drifted from the real `attachPipeline` interface then fails to compile here, which is the whole
 * point of the harness — `as never` would erase exactly the mismatch worth catching.
 */
type AttachConn = Parameters<typeof attachPipeline>[0];
type AttachStreamer = Parameters<typeof attachPipeline>[1];
type PlayOptions = Parameters<typeof mergePlayStreamOptions>[0];

function attach(
  conn: AttachConn,
  streamer: AttachStreamer,
  play: PlayOptions,
  cancelSignal?: AbortSignal,
) {
  return attachPipeline(
    conn,
    streamer,
    new PassThrough(),
    { ...mergePlayStreamOptions(play), configureConn: true },
    cancelSignal,
  );
}

/**
 * The audio-only voice segment every test in this file starts from: no video track, a recording
 * sink, and an attached pipeline. Declared once so a change to how a voice segment is built is a
 * single edit rather than one per test.
 */
async function voiceSegment() {
  const audio = audioTrack();
  demuxState.next = { video: undefined, audio };
  const sink = makeSink();
  const pipeline = await attach(makeConn(), makeStreamer(), {
    type: "voice",
    audioSink: sink,
  });
  return { audio, sink, pipeline };
}

describe("attachPipeline with an audio-only source", () => {
  test("plays through the audio stream and resolves done when it finishes", async () => {
    const audio = audioTrack();
    demuxState.next = { video: undefined, audio };
    const conn = makeConn();
    const sink = makeSink();

    const pipeline = await attach(conn, makeStreamer(), {
      type: "voice",
      audioSink: sink,
    });

    let settled = false;
    void pipeline.done.then(() => (settled = true));

    audio.stream.write(opusPacket(0));
    audio.stream.write(opusPacket(20));
    audio.stream.end();
    await pipeline.done;

    // `done` used to key on the video stream's `finish`. On an audio-only source that stream does
    // not exist, so this promise would never settle — a silent hang, with the caller reporting a
    // track still playing minutes after it ended.
    expect(settled).toBe(true);
    expect(sink.frames).toHaveLength(2);
  });

  test("hands each frame a 20 ms frametime, not 0", async () => {
    const { audio, sink, pipeline } = await voiceSegment();
    audio.stream.write(opusPacket(0));
    audio.stream.write(opusPacket(20));
    audio.stream.end();
    await pipeline.done;

    // The frametime is the pacer's whole sense of time and the RTP timestamp increment. A zero
    // would busy-spin the send loop and freeze the timestamp — audible only as drift in a live
    // listening test, so it is pinned here instead.
    expect(sink.frames.map((f) => f.frametimeMs)).toEqual([20, 20]);
  });

  test("sends frames to the sink instead of the connection when one is supplied", async () => {
    const audio = audioTrack();
    demuxState.next = { video: undefined, audio };
    const conn = makeConn();
    const sink = makeSink();

    const pipeline = await attach(conn, makeStreamer(), {
      type: "voice",
      audioSink: sink,
    });
    audio.stream.write(opusPacket(0));
    audio.stream.end();
    await pipeline.done;

    expect(sink.frames).toHaveLength(1);
    expect(conn.calls.sendAudioFrame).toBe(0);
  });

  test("falls back to the connection when no sink is supplied", async () => {
    const audio = audioTrack();
    demuxState.next = { video: undefined, audio };
    const conn = makeConn();

    const pipeline = await attach(conn, makeStreamer(), { type: "voice" });
    audio.stream.write(opusPacket(0));
    audio.stream.end();
    await pipeline.done;

    expect(conn.calls.sendAudioFrame).toBe(1);
  });

  test('type "voice" configures nothing on the shared connection', async () => {
    const audio = audioTrack();
    demuxState.next = { video: undefined, audio };
    const conn = makeConn();
    const streamer = makeStreamer();

    const pipeline = await attach(conn, streamer, {
      type: "voice",
      audioSink: makeSink(),
    });
    audio.stream.write(opusPacket(0));
    audio.stream.end();
    await pipeline.done;

    // The normal voice connection is shared with whatever else the consumer speaks over it, and
    // `setPacketizer` in particular would rebuild the audio packetizer while leaving the installed
    // media handler pointing at the old one — breaking this audio and any receive chain with it.
    expect(conn.calls).toEqual({
      setPacketizer: 0,
      setSpeaking: 0,
      setVideoAttributes: 0,
      sendAudioFrame: 0,
    });
    expect(streamer.calls.signalVideo).toBe(0);
    expect(streamer.calls.createStream).toBe(0);
    expect(streamer.calls.stopStream).toBe(0);
  });

  test('type "voice" rejects a source that still carries video', async () => {
    const video = videoTrack();
    demuxState.next = { video, audio: audioTrack() };
    const conn = makeConn();
    const streamer = makeStreamer();

    // A voice segment is audio and nothing else, so a video track means the source was built
    // wrong — `prepareStream({ audioOnly: true })` emits `-vn` and cannot produce one. Accepting it
    // is not a harmless no-op: LibavDemuxer drives ONE read loop for both tracks and pauses it when
    // the video pipe stops draining, so an unconsumed video track silently halts the audio too, a
    // few seconds in, with no error anywhere. Failing at attach is the only outcome that is not a
    // deadlock or a silent misconfiguration.
    await expect(
      attach(conn, streamer, { type: "voice", audioSink: makeSink() }),
    ).rejects.toThrow(/carries audio only/);

    // And it fails before touching the shared connection, so a rejected segment cannot leave the
    // consumer's own audio path reconfigured behind it.
    expect(conn.calls).toEqual({
      setPacketizer: 0,
      setSpeaking: 0,
      setVideoAttributes: 0,
      sendAudioFrame: 0,
    });
    expect(streamer.calls.signalVideo).toBe(0);

    video.stream.destroy();
  });

  test("binds the readrate burst gate to the audio stream", async () => {
    const audio = audioTrack();
    demuxState.next = { video: undefined, audio };
    const sink = makeSink();

    const pipeline = await attach(makeConn(), makeStreamer(), {
      type: "voice",
      readrateInitialBurst: 1,
      audioSink: sink,
    });
    const aStream = pipedAudioStream(audio.stream);

    // The gate is ON the audio stream from the start. Keyed on a video stream that an audio-only
    // segment never builds, `noSleep` would be false here and every frame would pace in realtime
    // through the burst window — the pre-roll silently lost.
    expect(aStream.noSleep).toBe(true);

    // A packet inside the burst window leaves it engaged.
    audio.stream.write(opusPacket(500));
    await waitFor(() => sink.frames.length === 1);
    expect(aStream.noSleep).toBe(true);

    // The first packet at the boundary releases it, handing the stream back to the pacer. This is
    // the transition the old wall-clock version could only infer from elapsed time.
    audio.stream.write(opusPacket(1000));
    await waitFor(() => sink.frames.length === 2);
    expect(aStream.noSleep).toBe(false);

    audio.stream.end();
    await pipeline.done;
  });

  test("paces from the first frame when no burst is requested", async () => {
    const audio = audioTrack();
    demuxState.next = { video: undefined, audio };
    const sink = makeSink();

    // The control: without `readrateInitialBurst` the gate must never engage at all. Together with
    // the test above this pins both states of the flag, which a single "finished quickly" bound
    // could not — that would also have passed if pacing had been skipped entirely.
    const pipeline = await attach(makeConn(), makeStreamer(), {
      type: "voice",
      audioSink: sink,
    });
    expect(pipedAudioStream(audio.stream).noSleep).toBe(false);

    audio.stream.end();
    await pipeline.done;
  });

  test("destroy() tears the audio side down and settles done", async () => {
    const { audio, sink, pipeline } = await voiceSegment();
    audio.stream.write(opusPacket(0));
    pipeline.destroy();
    await pipeline.done;

    // Whatever had already been paced out before destroy() is fair game; what must hold is that the
    // torn-down segment accepts nothing MORE. A superseded segment that kept writing would
    // interleave its frames with the replacement's and desync the RTP timestamp — the audio-desync
    // bug destroy() exists to prevent. Pinning the count as unchanged is the assertion; a bound
    // like "at most one" would also pass if teardown did nothing at all.
    const deliveredBeforeTeardown = sink.frames.length;
    audio.stream.write(opusPacket(20));
    audio.stream.write(opusPacket(40));
    audio.stream.end();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sink.frames).toHaveLength(deliveredBeforeTeardown);
  });

  test("a demuxer error rejects done", async () => {
    const audio = audioTrack();
    demuxState.next = { video: undefined, audio };

    const pipeline = await attach(makeConn(), makeStreamer(), {
      type: "voice",
      audioSink: makeSink(),
    });
    audio.stream.emit(
      "error",
      new Error("Received an error during frame extraction"),
    );

    await expect(pipeline.done).rejects.toThrow("frame extraction");
  });

  test('type "voice" with no audio track fails loudly', async () => {
    demuxState.next = { video: undefined, audio: undefined };

    await expect(
      attach(makeConn(), makeStreamer(), { type: "voice" }),
    ).rejects.toThrow("No audio stream in media");
  });
});

describe("attachPipeline video requirements are unchanged", () => {
  test('type "go-live" with no video still throws the original message', async () => {
    demuxState.next = { video: undefined, audio: audioTrack() };

    // Callers match on this string (streambot's hardware→software retry ladder among them), so the
    // audio-only branch must not repurpose it.
    await expect(
      attach(makeConn(), makeStreamer(), { type: "go-live" }),
    ).rejects.toThrow("No video stream in media");
  });

  test('type "go-live" still configures the connection for a video source', async () => {
    const video = videoTrack();
    const audio = audioTrack();
    demuxState.next = { video, audio };
    const conn = makeConn();

    const pipeline = await attach(conn, makeStreamer(), { type: "go-live" });
    expect(conn.calls.setPacketizer).toBe(1);
    expect(conn.calls.setSpeaking).toBe(1);
    expect(conn.calls.setVideoAttributes).toBe(1);

    video.stream.end();
    audio.stream.end();
    await pipeline.done;
  });
});
