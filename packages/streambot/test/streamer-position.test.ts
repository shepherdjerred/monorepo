import { describe, expect, test } from "bun:test";
import {
  StreambotStreamer,
  type PlayerFactory,
} from "@shepherdjerred/streambot/streamer/streamer.ts";
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
} from "@shepherdjerred/streambot/types/ids.ts";

const VOICE: VoiceHandle = {
  guildId: GuildIdSchema.parse("100000000000000010"),
  channelId: ChannelIdSchema.parse("100000000000000020"),
};
const RESOLVED: ResolvedSource = {
  title: "Movie",
  ffmpegInput: "/videos/movie.mkv",
};

function env(over: EnvLookup = {}): EnvLookup {
  return {
    BOT_TOKEN: "bot-token",
    TOKEN: "user-token",
    GUILD_ID: "100000000000000010",
    COMMAND_CHANNEL_ID: "100000000000000030",
    VIDEO_CHANNEL_ID: "100000000000000020",
    VIDEOS_DIR: "/videos",
    ...over,
  };
}

type SegmentControl = {
  resolve: () => void;
  reject: (error: unknown) => void;
  startTime: number | undefined;
};

/** A fake player factory that records the `-ss` start time and lets the test end each segment. */
function makeFakeFactory() {
  const segments: SegmentControl[] = [];
  const factory: PlayerFactory = (_streamer, _input, options) => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    segments.push({ resolve, reject, startTime: options?.prepare?.startTime });
    return {
      start: () => Promise.resolve(),
      seek: () => Promise.resolve(),
      setVolume: () => Promise.resolve(true),
      stop: () => {
        resolve();
      },
      finished,
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
  test("getPosition advances with the clock from the seek offset, then clears", async () => {
    const clock = { ms: 1000 };
    const { factory, segments } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "false" })),
      () => clock.ms,
      factory,
    );

    expect(streamer.getPosition()).toBeNull();

    const run = streamer.runStream(
      { voice: VOICE, resolved: RESOLVED, volume: 100, seekSeconds: 30 },
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

  test("HW→SW retry resumes at the elapsed position, not the start", async () => {
    const clock = { ms: 1000 };
    const { factory, segments } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
      () => clock.ms,
      factory,
    );

    const run = streamer.runStream(
      { voice: VOICE, resolved: RESOLVED, volume: 100, seekSeconds: 0 },
      new AbortController().signal,
    );
    await flush();
    expect(segments[0]?.startTime).toBeUndefined(); // fresh play, no -ss

    clock.ms = 9000; // 8s played before the encoder fails
    segments[0]?.reject(new Error("vaapi boom"));
    await flush();

    // The software retry restarts at ~8s, not from 0.
    expect(segments).toHaveLength(2);
    expect(segments[1]?.startTime).toBe(8);

    segments[1]?.resolve();
    await run;
  });
});
