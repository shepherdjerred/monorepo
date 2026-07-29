import { describe, expect, test } from "bun:test";
import {
  StreambotStreamer,
  type PlayerFactory,
  type StreamObserverFactory,
} from "@shepherdjerred/streambot/streamer/streamer.ts";
import { StreamCrashError } from "@shepherdjerred/streambot/streamer/stream-errors.ts";
import {
  loadConfig,
  type EnvLookup,
} from "@shepherdjerred/streambot/config/index.ts";
import type {
  ResolvedSource,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserTokenSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const USER_TOKEN = UserTokenSchema.parse("user-token");
const VOICE: VoiceHandle = {
  guildId: GuildIdSchema.parse("100000000000000010"),
  channelId: ChannelIdSchema.parse("100000000000000020"),
};
const RESOLVED: ResolvedSource = {
  title: "Movie",
  ffmpegInput: "/videos/movie.mkv",
  chapters: [],
};

function env(over: EnvLookup = {}): EnvLookup {
  return {
    BOT_TOKEN: "bot-token",
    USER_TOKENS: "user-token",
    VIDEOS_DIR: "/videos",
    ...over,
  };
}

type SegmentControl = {
  resolve: () => void;
  reject: (error: unknown) => void;
  startTime: number | undefined;
  seekTargets: number[];
};

function createVoidDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  const deferred = Promise.withResolvers<null>();
  return {
    promise: (async () => {
      await deferred.promise;
    })(),
    resolve: () => deferred.resolve(null),
    reject: deferred.reject,
  };
}

/**
 * A fake player factory that records the `-ss` start time and lets the test end each segment.
 * `startErrors[i]` makes segment i's `start()` reject — the startup-failure path, as opposed to
 * rejecting `finished` (a mid-stream crash).
 */
function makeFakeFactory(
  startErrors: (Error | undefined)[] = [],
  seekErrors: (Error | undefined)[] = [],
  seekGates: (Promise<void> | undefined)[] = [],
) {
  const segments: SegmentControl[] = [];
  const factory: PlayerFactory = (_streamer, _input, options) => {
    const segmentIndex = segments.length;
    const finished = createVoidDeferred();
    const startError = startErrors[segmentIndex];
    const seekError = seekErrors[segmentIndex];
    const seekGate = seekGates[segmentIndex];
    const seekTargets: number[] = [];
    segments.push({
      resolve: finished.resolve,
      reject: finished.reject,
      startTime: options?.prepare?.startTime,
      seekTargets,
    });
    return {
      start: () =>
        startError === undefined
          ? Promise.resolve()
          : Promise.reject(startError),
      seek: async (seconds) => {
        seekTargets.push(seconds);
        if (seekError !== undefined) {
          throw seekError;
        }
        await seekGate;
      },
      setVolume: () => Promise.resolve(true),
      stop: () => {
        finished.resolve();
      },
      finished: finished.promise,
      position: 0,
    };
  };
  return { factory, segments };
}

/** Flush pending microtasks so the streamer reaches its `await player.finished` parking point. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe("StreambotStreamer position tracking", () => {
  test("a startup-time stall uses the new segment offset before playback starts", async () => {
    const start = createVoidDeferred();
    const finished = createVoidDeferred();
    let onStall: ((lastMediaSeconds: number | undefined) => void) | undefined;
    const observerFactory: StreamObserverFactory = (
      _hardware,
      _now,
      nextOnStall,
    ) => {
      onStall = nextOnStall;
      return { observer: {}, dispose: () => null };
    };
    const factory: PlayerFactory = () => ({
      start: () => {
        onStall?.(0.33);
        return start.promise;
      },
      seek: () => Promise.resolve(),
      setVolume: () => Promise.resolve(true),
      stop: finished.resolve,
      finished: finished.promise,
      position: 0,
    });
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "false" })),
      Date.now,
      { createPlayer: factory, createObserver: observerFactory },
    );
    let stallPosition: number | undefined;
    streamer.setStallListener((info) => {
      stallPosition = info.positionSeconds;
    });

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED,
        volume: 100,
        seekSeconds: 3804,
        pipelineMode: "sw",
      },
      new AbortController().signal,
    );
    await flush();

    expect(stallPosition).toBeCloseTo(3804.33, 5);
    expect(streamer.getPosition()).toBeNull();

    start.resolve();
    await flush();
    finished.resolve();
    await run;
  });

  test("getPosition advances with the clock from the seek offset, then clears", async () => {
    const clock = { ms: 1000 };
    const { factory, segments } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "false" })),
      () => clock.ms,
      factory,
    );

    expect(streamer.getPosition()).toBeNull();

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED,
        volume: 100,
        seekSeconds: 30,
        pipelineMode: "hw",
      },
      new AbortController().signal,
    );
    await flush();

    // The resume offset reached ffmpeg as -ss 30, and position is anchored there.
    expect(segments[0]?.startTime).toBe(30);
    expect(streamer.getPosition()).toBe(30);

    clock.ms = 6000; // +5s of playback
    expect(streamer.getPosition()).toBe(35);

    segments[0]?.resolve();
    await run;
    expect(streamer.getPosition()).toBeNull();
  });

  test("a successful live seek re-anchors the position before returning", async () => {
    const clock = { ms: 1000 };
    const { factory, segments } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "false" })),
      () => clock.ms,
      factory,
    );
    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED,
        volume: 100,
        seekSeconds: 30,
        pipelineMode: "sw",
      },
      new AbortController().signal,
    );
    await flush();

    clock.ms = 6000;
    expect(streamer.getPosition()).toBe(35);
    await expect(streamer.seek(120)).resolves.toBe(true);
    expect(segments[0]?.seekTargets).toEqual([120]);
    expect(streamer.getPosition()).toBe(120);

    clock.ms = 8000;
    expect(streamer.getPosition()).toBe(122);
    segments[0]?.resolve();
    await run;
  });

  test("a live seek freezes position while its replacement attaches", async () => {
    const clock = { ms: 1000 };
    const seekAttach = createVoidDeferred();
    const { factory, segments } = makeFakeFactory([], [], [seekAttach.promise]);
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "false" })),
      () => clock.ms,
      factory,
    );
    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED,
        volume: 100,
        seekSeconds: 30,
        pipelineMode: "sw",
      },
      new AbortController().signal,
    );
    await flush();

    clock.ms = 6000;
    const seek = streamer.seek(120);
    await flush();
    clock.ms = 9000;
    expect(streamer.getPosition()).toBe(35);

    seekAttach.resolve();
    await expect(seek).resolves.toBe(true);
    expect(streamer.getPosition()).toBe(120);

    clock.ms = 11_000;
    expect(streamer.getPosition()).toBe(122);
    segments[0]?.resolve();
    await run;
  });

  test("a failed live seek restores the prior playback anchor", async () => {
    const clock = { ms: 1000 };
    const seekError = new Error("seek restart failed");
    const { factory, segments } = makeFakeFactory([], [seekError]);
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "false" })),
      () => clock.ms,
      factory,
    );
    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED,
        volume: 100,
        seekSeconds: 30,
        pipelineMode: "sw",
      },
      new AbortController().signal,
    );
    await flush();

    clock.ms = 6000;
    expect(streamer.getPosition()).toBe(35);
    await expect(streamer.seek(120)).rejects.toThrow("seek restart failed");
    expect(segments[0]?.seekTargets).toEqual([120]);
    expect(streamer.getPosition()).toBe(35);

    segments[0]?.resolve();
    await run;
  });
});

describe("StreambotStreamer failure position tracking", () => {
  test("a mid-stream failure surfaces as StreamCrashError with the elapsed position — no in-streamer retry", async () => {
    const clock = { ms: 1000 };
    const { factory, segments } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
      () => clock.ms,
      factory,
    );

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED,
        volume: 100,
        seekSeconds: 0,
        pipelineMode: "hw",
      },
      new AbortController().signal,
    );
    await flush();
    expect(segments[0]?.startTime).toBeUndefined(); // fresh play, no -ss

    clock.ms = 9000; // 8s played before ffmpeg dies
    segments[0]?.reject(new Error("ffmpeg exited with code 218"));

    // The machine owns mid-stream recovery: the crash propagates with its position, and the
    // streamer does NOT spawn its own software retry.
    await expect(run).rejects.toBeInstanceOf(StreamCrashError);
    await run.catch((error: unknown) => {
      if (!(error instanceof StreamCrashError)) throw new Error("unreachable");
      expect(error.kind).toBe("crash");
      expect(error.positionSeconds).toBe(8);
      expect(error.pipelineMode).toBe("hw");
    });
    expect(segments).toHaveLength(1);
  });

  test("a STARTUP failure still falls back to software in-streamer, resuming at the requested offset", async () => {
    const clock = { ms: 1000 };
    const { factory, segments } = makeFakeFactory([
      new Error("vaapi device init failed"),
    ]);
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
      () => clock.ms,
      factory,
    );

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED,
        volume: 100,
        seekSeconds: 30,
        pipelineMode: "hw",
      },
      new AbortController().signal,
    );
    await flush();

    // start() rejected before playback began → the classic in-streamer software fallback, at the
    // last known position (playback never started, so the requested offset).
    expect(segments).toHaveLength(2);
    expect(segments[1]?.startTime).toBe(30);

    segments[1]?.resolve();
    await run;
  });

  test("exit-0 far short of the probed duration classifies as ended-short", async () => {
    const clock = { ms: 0 };
    const { factory, segments } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
      () => clock.ms,
      factory,
    );

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: { ...RESOLVED, durationSeconds: 7200 },
        volume: 100,
        seekSeconds: 0,
        pipelineMode: "hw",
      },
      new AbortController().signal,
    );
    await flush();

    clock.ms = 40_000; // "played" 40s of a 2h movie, then ffmpeg exited 0
    segments[0]?.resolve();

    await expect(run).rejects.toBeInstanceOf(StreamCrashError);
    await run.catch((error: unknown) => {
      if (!(error instanceof StreamCrashError)) throw new Error("unreachable");
      expect(error.kind).toBe("ended-short");
      expect(error.positionSeconds).toBe(40);
      expect(error.exitCode).toBe(0);
    });
  });

  test("exit-0 near the probed duration is a natural end", async () => {
    const clock = { ms: 0 };
    const { factory, segments } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
      () => clock.ms,
      factory,
    );

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: { ...RESOLVED, durationSeconds: 7200 },
        volume: 100,
        seekSeconds: 0,
        pipelineMode: "hw",
      },
      new AbortController().signal,
    );
    await flush();

    clock.ms = 7_190_000; // within 30s of the end
    segments[0]?.resolve();
    await run; // resolves — no ended-short misclassification
  });
});
