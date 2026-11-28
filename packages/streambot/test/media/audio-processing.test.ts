import { afterEach, describe, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { NoopProvider } from "@shepherdjerred/feature-flags/providers/noop.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  LOUDNESS_NORMALIZER,
  prepareStream,
  type PrepareStreamOptions,
} from "@shepherdjerred/discord-video-stream";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  audioProcessingFlags,
  type AudioProcessingFlags,
} from "@shepherdjerred/streambot/config/media-features.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { buildPlaybackPrepareOptions } from "@shepherdjerred/streambot/streamer/prepare-options.ts";
import { streamerEnv as env } from "./streamer/streamer-test-fixtures.ts";

const stream = { ...loadConfig(env()).stream, width: 1920, height: 1080 };

const OFF: AudioProcessingFlags = {
  dialogDownmix: false,
  loudnessNormalization: false,
  liveResync: false,
  trackRanking: false,
};
const ON: AudioProcessingFlags = {
  dialogDownmix: true,
  loudnessNormalization: true,
  liveResync: true,
  trackRanking: true,
};

const STEREO_FILE: ResolvedSource = {
  title: "Stereo film",
  ffmpegInput: "/videos/stereo.mkv",
  mediaKind: "video",
  chapters: [],
  ffmpegVideoStreamIndex: 0,
  probedVideo: { displayAspect: 16 / 9, rotation: 0, interlaced: false },
  probedAudio: { channels: 2, channelLayout: "stereo" },
  rankedTracks: {
    videoStreamIndex: 0,
    video: { displayAspect: 16 / 9, rotation: 0, interlaced: false },
    hdr: false,
    audioStreamIndex: 0,
    audio: { channels: 2, channelLayout: "stereo" },
  },
};

/** A remux whose first audio track is a stereo commentary and whose second is the 5.1 mix. */
const SURROUND_FILE: ResolvedSource = {
  ...STEREO_FILE,
  title: "Surround film",
  ffmpegInput: "/videos/surround.mkv",
  probedAudio: { channels: 2, channelLayout: "stereo" },
  rankedTracks: {
    ...STEREO_FILE.rankedTracks,
    audioStreamIndex: 1,
    audio: { channels: 6, channelLayout: "5.1(side)" },
  },
};

const TWITCH_LIVE: ResolvedSource = {
  title: "Twitch",
  ffmpegInput: "https://usher.invalid/live.m3u8",
  mediaKind: "video",
  chapters: [],
  live: true,
  discontinuousLive: true,
  probedAudio: { channels: 2, channelLayout: "stereo" },
  rankedTracks: { audioStreamIndex: 0, audio: { channels: 2 } },
};

const MUSIC: ResolvedSource = {
  title: "A Song",
  ffmpegInput: "https://media.invalid/audio.webm",
  mediaKind: "music",
  chapters: [],
  probedAudio: { channels: 2, channelLayout: "stereo" },
  rankedTracks: { audioStreamIndex: 0, audio: { channels: 2 } },
};

function options(
  resolved: ResolvedSource,
  audioProcessing: AudioProcessingFlags,
): Partial<PrepareStreamOptions> {
  return buildPlaybackPrepareOptions({
    stream,
    resolved,
    startSeconds: 0,
    volumePercent: 100,
    pipelineMode: "sw",
    audioProcessing,
  });
}

/** The ffmpeg command line the fork would run for these options. */
async function ffmpegArgs(
  prepare: Partial<PrepareStreamOptions>,
): Promise<string[]> {
  const { command, output, promise } = prepareStream("input", prepare);
  try {
    return [...command.args];
  } finally {
    command.kill("SIGKILL");
    output.destroy();
    await Promise.allSettled([promise]);
  }
}

/** The audio half of that command: its map, channel options and filter chain. */
async function audioStage(
  resolved: ResolvedSource,
  flags: AudioProcessingFlags,
) {
  const args = await ffmpegArgs(options(resolved, flags));
  const filter = args[args.indexOf("-filter:a") + 1];
  const audioMapAt = args.lastIndexOf("-map");
  return {
    map: args[audioMapAt + 1],
    channels: args.includes("-lfe_mix_level") ? "-ac 2 -lfe_mix_level 1" : "",
    filter,
  };
}

/** The same source without anything these flags read, i.e. what was resolved before them. */
function withoutFlagInputs(resolved: ResolvedSource): ResolvedSource {
  const { rankedTracks: _ranked, probedAudio: _audio, ...rest } = resolved;
  return rest;
}

describe("audio processing flags off", () => {
  test.each([
    ["stereo file", STEREO_FILE],
    ["5.1(side) file", SURROUND_FILE],
    ["Twitch live", TWITCH_LIVE],
    ["music", MUSIC],
  ])(
    "%s: byte-identical options and ffmpeg arguments",
    async (_name, resolved) => {
      const built = options(resolved, OFF);
      expect(built).toEqual(options(withoutFlagInputs(resolved), OFF));
      expect("audioProcessing" in built).toBe(false);
      const args = await ffmpegArgs(built);
      expect(args).toEqual(
        await ffmpegArgs(options(withoutFlagInputs(resolved), OFF)),
      );
      expect(await audioStage(resolved, OFF)).toMatchObject({
        channels: "-ac 2 -lfe_mix_level 1",
        filter: "volume@internal_lib=1.0",
      });
    },
  );
});

describe("audio processing flags on", () => {
  test("stereo keeps -ac 2 and gains only the normaliser", async () => {
    expect(await audioStage(STEREO_FILE, ON)).toEqual({
      map: "0:a:0",
      channels: "-ac 2 -lfe_mix_level 1",
      filter: `${LOUDNESS_NORMALIZER},volume@internal_lib=1.0`,
    });
  });

  test("5.1(side) plays the ranked surround track through the dialogue downmix", async () => {
    expect(await audioStage(SURROUND_FILE, ON)).toEqual({
      map: "0:a:1",
      channels: "",
      filter:
        "pan=stereo|FL=FC+0.707*FL+0.5*SL|FR=FC+0.707*FR+0.5*SR," +
        `${LOUDNESS_NORMALIZER},alimiter=limit=0.891:level=disabled,volume@internal_lib=1.0`,
    });
  });

  test("Twitch live resyncs audio onto its timestamps before anything else", async () => {
    expect(await audioStage(TWITCH_LIVE, ON)).toEqual({
      map: "0:a:0",
      channels: "-ac 2 -lfe_mix_level 1",
      filter: `aresample=async=1:first_pts=0,${LOUDNESS_NORMALIZER},volume@internal_lib=1.0`,
    });
  });

  test("music normalises but never resyncs, even from a live source", async () => {
    expect(await audioStage({ ...MUSIC, live: true }, ON)).toEqual({
      map: "0:a:0",
      channels: "-ac 2 -lfe_mix_level 1",
      filter: `${LOUDNESS_NORMALIZER},volume@internal_lib=1.0`,
    });
  });
});

describe("each audio flag alone", () => {
  test("dialogue downmix needs a layout with a matrix", () => {
    const flags = { ...OFF, dialogDownmix: true };
    const { probedAudio: _audio, ...unprobed } = STEREO_FILE;
    const surround = (probedAudio: ResolvedSource["probedAudio"]) =>
      options(
        probedAudio === undefined ? unprobed : { ...unprobed, probedAudio },
        flags,
      ).audioProcessing;
    expect(surround({ channels: 6, channelLayout: "5.1(side)" })).toEqual({
      dialogDownmix: "5.1(side)",
    });
    expect(surround({ channels: 6, channelLayout: "5.1" })).toEqual({
      dialogDownmix: "5.1",
    });
    expect(surround({ channels: 8, channelLayout: "7.1" })).toEqual({
      dialogDownmix: "7.1",
    });
    // Mono, stereo, an unmatrixed layout, and a channel count with no layout keep `-ac 2`.
    for (const audio of [
      { channels: 1, channelLayout: "mono" },
      { channels: 2, channelLayout: "stereo" },
      { channels: 4, channelLayout: "quad" },
      { channels: 6 },
      undefined,
    ])
      expect(surround(audio)).toBeUndefined();
  });

  test("dialogue downmix reads the legacy track's layout while ranking is off", () => {
    expect(
      options(SURROUND_FILE, { ...OFF, dialogDownmix: true }).audioProcessing,
    ).toBeUndefined();
    expect(
      options(SURROUND_FILE, {
        ...OFF,
        dialogDownmix: true,
        trackRanking: true,
      }).audioProcessing,
    ).toEqual({ dialogDownmix: "5.1(side)" });
  });

  test("loudness normalisation applies to video and music", () => {
    const flags = { ...OFF, loudnessNormalization: true };
    for (const resolved of [STEREO_FILE, TWITCH_LIVE, MUSIC])
      expect(options(resolved, flags).audioProcessing).toEqual({
        loudnessNormalization: true,
      });
  });

  test("live resync applies only to timestamp-normalised live video", () => {
    const flags = { ...OFF, liveResync: true };
    expect(options(TWITCH_LIVE, flags).audioProcessing).toEqual({
      resyncTimestamps: true,
    });
    expect(
      options({ ...TWITCH_LIVE, discontinuousLive: false }, flags)
        .audioProcessing,
    ).toBeUndefined();
    expect(options(STEREO_FILE, flags).audioProcessing).toBeUndefined();
    expect(
      options({ ...MUSIC, live: true }, flags).audioProcessing,
    ).toBeUndefined();
  });

  test("track ranking swaps every stream together with the facts describing it", () => {
    const hdrVariant: ResolvedSource = {
      ...STEREO_FILE,
      ffmpegVideoStreamIndex: 0,
      ffmpegAudioStreamIndex: 0,
      hdr: false,
      probedVideo: { displayAspect: 4 / 3, rotation: 0, interlaced: false },
      rankedTracks: {
        videoStreamIndex: 2,
        video: { displayAspect: 2.39, rotation: 0, interlaced: false },
        hdr: true,
        audioStreamIndex: 1,
        audio: { channels: 6, channelLayout: "5.1" },
      },
    };
    const flags = { ...OFF, trackRanking: true };
    const ranked = options(hdrVariant, flags);
    expect(ranked).toMatchObject({
      videoStreamIndex: 2,
      audioStreamIndex: 1,
      inputColor: "hdr",
      width: 1920,
      height: 804,
    });
    const legacy = options(hdrVariant, OFF);
    expect(legacy).toMatchObject({
      videoStreamIndex: 0,
      audioStreamIndex: 0,
      inputColor: "sdr",
      width: 1440,
      height: 1080,
    });
  });

  test("track ranking maps the ranked music track; off, music keeps 0:a:0", async () => {
    const music = {
      ...MUSIC,
      rankedTracks: { audioStreamIndex: 2, audio: { channels: 2 } },
    };
    expect(
      options(music, { ...OFF, trackRanking: true }).audioStreamIndex,
    ).toBe(2);
    expect("audioStreamIndex" in options(music, OFF)).toBe(false);
    const { map } = await audioStage(music, OFF);
    expect(map).toBe("0:a:0");
  });

  test("track ranking without a ranked probe keeps the legacy streams", () => {
    const { rankedTracks: _ranked, ...unranked } = SURROUND_FILE;
    expect(options(unranked, { ...OFF, trackRanking: true })).toEqual(
      options(unranked, OFF),
    );
  });
});

describe("audioProcessingFlags", () => {
  afterEach(async () => {
    await shutdownFeatureFlags();
  });

  test("an absent flag resolves to the inventory default (on)", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new NoopProvider(),
    });
    expect(await audioProcessingFlags("100000000000000010")).toEqual(ON);
  });

  test("an explicit false turns off exactly that step", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "static" },
      provider: new StaticProvider({
        "streambot-audio-dialog-downmix-enabled": false,
        "streambot-audio-live-resync-enabled": false,
        "streambot-audio-loudness-normalization-enabled": true,
        "streambot-audio-track-ranking-enabled": true,
      }),
    });
    expect(await audioProcessingFlags("100000000000000010")).toEqual({
      dialogDownmix: false,
      loudnessNormalization: true,
      liveResync: false,
      trackRanking: true,
    });
  });
});
