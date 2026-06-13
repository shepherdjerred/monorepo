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
  UserTokenSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const USER_TOKEN = UserTokenSchema.parse("user-token");
const VOICE: VoiceHandle = {
  guildId: GuildIdSchema.parse("100000000000000010"),
  channelId: ChannelIdSchema.parse("100000000000000020"),
};
const SUBTITLE_PATH = "/tmp/streambot-subs/test-pipeline.srt";
const RESOLVED_HDR_WITH_SUBS: ResolvedSource = {
  title: "Movie",
  ffmpegInput: "/videos/movie.mkv",
  chapters: [],
  subtitle: { path: SUBTITLE_PATH, cleanupPath: SUBTITLE_PATH },
  hdr: true,
};

function env(over: EnvLookup = {}): EnvLookup {
  return {
    BOT_TOKEN: "bot-token",
    USER_TOKENS: "user-token",
    VIDEOS_DIR: "/videos",
    ...over,
  };
}

type PrepareSnapshot = {
  hardwareAcceleratedDecoding: boolean | undefined;
  hasEncoder: boolean;
  subtitleBurn: { path: string } | undefined;
  inputColor: string | undefined;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Fake player factory recording the prepare options each ffmpeg attempt would receive. */
function makeFakeFactory() {
  const attempts: PrepareSnapshot[] = [];
  const factory: PlayerFactory = (_streamer, _input, options) => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    attempts.push({
      hardwareAcceleratedDecoding:
        options?.prepare?.hardwareAcceleratedDecoding,
      hasEncoder: options?.prepare?.encoder !== undefined,
      subtitleBurn: options?.prepare?.subtitleBurn,
      inputColor: options?.prepare?.inputColor,
      resolve,
      reject,
    });
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
  return { factory, attempts };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe("StreambotStreamer pipeline options", () => {
  test("subtitles no longer force software: HW attempt carries subtitleBurn + inputColor hdr", async () => {
    const { factory, attempts } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
      () => 0,
      factory,
    );

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED_HDR_WITH_SUBS,
        volume: 100,
        seekSeconds: 0,
      },
      new AbortController().signal,
    );
    await flush();

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.hardwareAcceleratedDecoding).toBe(true);
    expect(attempts[0]?.hasEncoder).toBe(true); // VAAPI encoder despite the subtitle burn
    expect(attempts[0]?.subtitleBurn).toEqual({ path: SUBTITLE_PATH });
    expect(attempts[0]?.inputColor).toBe("hdr");

    attempts[0]?.resolve();
    await run;
  });

  test("HW→SW retry keeps subtitleBurn and inputColor so the software graph tonemaps + burns", async () => {
    const { factory, attempts } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
      () => 0,
      factory,
    );

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: RESOLVED_HDR_WITH_SUBS,
        volume: 100,
        seekSeconds: 0,
      },
      new AbortController().signal,
    );
    await flush();
    attempts[0]?.reject(new Error("overlay_vaapi unsupported"));
    await flush();

    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.hardwareAcceleratedDecoding).toBe(false);
    expect(attempts[1]?.hasEncoder).toBe(false); // software encoder on the retry
    expect(attempts[1]?.subtitleBurn).toEqual({ path: SUBTITLE_PATH });
    expect(attempts[1]?.inputColor).toBe("hdr");

    attempts[1]?.resolve();
    await run;
  });

  test("SDR source without subtitles passes inputColor sdr and no subtitleBurn", async () => {
    const { factory, attempts } = makeFakeFactory();
    const streamer = new StreambotStreamer(
      USER_TOKEN,
      loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
      () => 0,
      factory,
    );

    const run = streamer.runStream(
      {
        voice: VOICE,
        resolved: {
          title: "Movie",
          ffmpegInput: "/videos/m.mkv",
          chapters: [],
        },
        volume: 100,
        seekSeconds: 0,
      },
      new AbortController().signal,
    );
    await flush();

    expect(attempts[0]?.subtitleBurn).toBeUndefined();
    expect(attempts[0]?.inputColor).toBe("sdr");

    attempts[0]?.resolve();
    await run;
  });
});
