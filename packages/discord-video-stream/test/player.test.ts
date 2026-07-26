import { describe, expect, test } from "bun:test";
import { createSeekablePlayer } from "../src/media/player.ts";

// This file is run by bun but is intentionally outside the package's tsconfig `include`, so the
// loosely-typed fakes below don't need to satisfy the real Streamer / dependency types.

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeConn() {
  const speaking = [];
  const videoAttrs = [];
  return {
    speaking,
    videoAttrs,
    mediaConnection: {
      setSpeaking: (v) => speaking.push(v),
      setVideoAttributes: (v) => videoAttrs.push(v),
    },
  };
}

function makeStreamer() {
  const conn = makeConn();
  const calls = { createStream: 0, stopStream: 0, signalVideo: 0 };
  return {
    conn,
    calls,
    createStream: () => {
      calls.createStream++;
      return Promise.resolve(conn);
    },
    stopStream: () => {
      calls.stopStream++;
    },
    signalVideo: () => {
      calls.signalVideo++;
    },
    voiceConnection: { webRtcConn: conn },
  };
}

/**
 * Fake prepareStream/attachPipeline that record calls and expose per-segment control.
 * `attachErrors[i]` makes attach attempt i reject (the graph-init failure path).
 */
function makeDeps(attachErrors = []) {
  const prepareCalls = [];
  const subtitleBurnCalls = [];
  const signals = [];
  const ffmpeg = [];
  const attachCalls = [];
  const segments = [];
  const destroyed = [];
  const volumes = [];

  const deps = {
    prepareStream: (_input, opts, signal) => {
      prepareCalls.push({ startTime: opts.startTime });
      subtitleBurnCalls.push(opts.subtitleBurn);
      signals.push(signal);
      const ff = deferred();
      ffmpeg.push(ff);
      return {
        command: { kill: () => {} },
        output: {},
        promise: ff.promise,
        controller: {
          volume: 1,
          setVolume: (v) => {
            volumes.push(v);
            return Promise.resolve(true);
          },
        },
      };
    },
    attachPipeline: (conn, _streamer, _input, opts) => {
      const index = attachCalls.length;
      attachCalls.push({ configureConn: opts.configureConn, conn });
      const attachError = attachErrors[index];
      if (attachError !== undefined) return Promise.reject(attachError);
      const seg = deferred();
      segments.push(seg);
      return Promise.resolve({
        done: seg.promise,
        destroy: () => {
          destroyed.push(index);
          seg.resolve();
        },
      });
    },
  };

  return {
    deps,
    prepareCalls,
    subtitleBurnCalls,
    signals,
    ffmpeg,
    attachCalls,
    segments,
    destroyed,
    volumes,
  };
}

describe("createSeekablePlayer", () => {
  test("start opens the Go-Live stream once and attaches a configured first segment", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);

    await player.start();

    expect(streamer.calls.createStream).toBe(1);
    expect(f.prepareCalls).toEqual([{ startTime: undefined }]);
    expect(f.attachCalls).toHaveLength(1);
    expect(f.attachCalls[0]?.configureConn).toBe(true);
    expect(player.position).toBe(0);
  });

  test("natural end resolves finished and tears down the connection", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();

    let done = false;
    void player.finished.then(() => (done = true));
    f.segments[0]?.resolve(); // natural EOF of the only segment
    f.ffmpeg[0]?.resolve(); // ffmpeg exits cleanly — confirms the drain was a real end
    await player.finished;

    expect(done).toBe(true);
    expect(streamer.calls.stopStream).toBe(1);
    expect(streamer.conn.speaking).toContain(false);
  });

  test("ffmpeg crash after output drain rejects finished (crash is not EOF)", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();

    // The crashed ffmpeg's closed pipe drains the demuxer first (pipeline done resolves), THEN
    // the ffmpeg error lands. Previously succeed() won this race and the crash looked like EOF.
    f.segments[0]?.resolve();
    await Promise.resolve();
    f.ffmpeg[0]?.reject(new Error("ffmpeg exited with code 218"));

    await expect(player.finished).rejects.toThrow("exited with code 218");
    // The connection is torn down on failure too.
    expect(streamer.calls.stopStream).toBe(1);
  });

  test("ffmpeg that never settles after drain aborts the wedged process and rejects finished", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(
      streamer,
      "video.mkv",
      { ffmpegSettleTimeoutMs: 20 },
      f.deps,
    );
    await player.start();

    f.segments[0]?.resolve(); // drain, but the ffmpeg promise stays pending (wedged) forever
    // A drained-but-wedged ffmpeg is a failure, not a natural end: `finished` rejects rather than
    // resolving, and the process is aborted so it can't linger as an orphan.
    await expect(player.finished).rejects.toThrow("did not settle");
    expect(f.signals[0]?.aborted).toBe(true);
    expect(streamer.calls.stopStream).toBe(1);
  });

  test("initial attach failure rejects start() (startup/graph-init failure, not a mid-stream crash)", async () => {
    const streamer = makeStreamer();
    const f = makeDeps([new Error("overlay_vaapi unsupported")]);
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);

    // A failed FIRST attach must reject start() so the caller keeps it on the immediate software
    // fallback — NOT swallow it into `finished` (which would look like a mid-stream crash).
    await expect(player.start()).rejects.toThrow("overlay_vaapi unsupported");
    // The paired ffmpeg is aborted so it can't linger.
    expect(f.signals[0]?.aborted).toBe(true);
  });

  test("stop during a pending ffmpeg settle resolves finished", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();

    f.segments[0]?.resolve(); // drain; ffmpeg still pending
    await Promise.resolve();
    player.stop();
    await player.finished;

    // A late ffmpeg rejection after stop must not surface anywhere.
    f.ffmpeg[0]?.reject(new Error("late crash"));
    await player.finished;
  });

  test("a superseded segment's ffmpeg crash after a seek does not reject finished", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();

    f.segments[0]?.resolve(); // old segment drains…
    await player.seek(30); // …but a seek supersedes it before ffmpeg settles
    f.ffmpeg[0]?.reject(new Error("old segment crash"));

    // The live segment ends cleanly.
    f.segments[1]?.resolve();
    f.ffmpeg[1]?.resolve();
    await player.finished;
  });

  test("a demuxer error (pipeline done rejection) rejects finished", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();

    f.segments[0]?.reject(new Error("Received an error during frame extraction"));

    await expect(player.finished).rejects.toThrow("frame extraction");
    expect(streamer.calls.stopStream).toBe(1);
  });

  test("seek restarts ffmpeg at the offset, reuses the connection, and does not reconfigure it", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();

    await player.seek(90);

    // Go-Live created exactly once across start + seek.
    expect(streamer.calls.createStream).toBe(1);
    // Second prepare carries the -ss offset; second attach does NOT reconfigure (preserves RTP).
    expect(f.prepareCalls).toEqual([{ startTime: undefined }, { startTime: 90 }]);
    expect(f.attachCalls.map((c) => c.configureConn)).toEqual([true, false]);
    expect(f.attachCalls[1]?.conn).toBe(f.attachCalls[0]?.conn);
    expect(player.position).toBe(90);
    // The first segment was torn down by the seek.
    expect(f.destroyed).toContain(0);
  });

  test("a superseded segment ending does not resolve finished", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();
    await player.seek(30);

    let resolved = false;
    void player.finished.then(() => (resolved = true));
    // Resolving the OLD (superseded) segment must not end playback.
    f.segments[0]?.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    // The live (second) segment ending (drain + clean ffmpeg exit) does end playback.
    f.segments[1]?.resolve();
    f.ffmpeg[1]?.resolve();
    await player.finished;
    expect(resolved).toBe(true);
  });

  test("ffmpeg failure rejects finished", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();

    f.ffmpeg[0]?.reject(new Error("ffmpeg boom"));

    await expect(player.finished).rejects.toThrow("ffmpeg boom");
  });

  test("stop resolves finished and tears down the connection", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    await player.start();

    player.stop();
    await player.finished;
    expect(streamer.calls.stopStream).toBe(1);
  });

  test("prepare.subtitleBurn is applied on start AND re-applied after seek with the new offset", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const subtitleBurn = { path: "/tmp/streambot-subs/x.srt" };
    const player = createSeekablePlayer(
      streamer,
      "video.mkv",
      { prepare: { subtitleBurn } },
      f.deps,
    );
    await player.start();
    await player.seek(120);

    // The same subtitleBurn option reaches ffmpeg on the initial segment and on the post-seek
    // restart, and each restart carries its own startTime — prepareStream derives the subtitle
    // PTS compensation from that, so the burned cues track the seek (and, by the same mechanism,
    // the HW→SW retry).
    expect(f.subtitleBurnCalls).toEqual([subtitleBurn, subtitleBurn]);
    expect(f.prepareCalls).toEqual([
      { startTime: undefined },
      { startTime: 120 },
    ]);
  });

  test("setVolume delegates to the active segment controller", async () => {
    const streamer = makeStreamer();
    const f = makeDeps();
    const player = createSeekablePlayer(streamer, "video.mkv", {}, f.deps);
    expect(await player.setVolume(0.5)).toBe(false); // nothing playing yet
    await player.start();
    expect(await player.setVolume(0.5)).toBe(true);
    expect(f.volumes).toEqual([0.5]);
  });
});
