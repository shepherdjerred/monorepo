import { afterEach, expect, test, vi } from "vitest";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import * as probe from "@shepherdjerred/streambot/sources/probe.ts";
import * as ytdlp from "@shepherdjerred/streambot/sources/ytdlp.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { LolEsportsClient, lolSportsEvent } from "./lolesports.ts";
import { lolMatch } from "#lol-fixture";
import { buildVideoPrepareOptions } from "@shepherdjerred/streambot/streamer/prepare-options.ts";
import { prepareStream } from "@shepherdjerred/discord-video-stream";

const config = loadConfig({
  BOT_TOKEN: "bot-token",
  TOKEN: "user-token",
  VIDEOS_DIR: "/tmp/videos",
});
const video: probe.MediaInfo = {
  videoCodec: "h264",
  videoStreamIndex: 1,
  width: 1280,
  height: 720,
  pixelFormat: "yuv420p",
  hdr: false,
  audioCodec: "unknown",
  audioChannels: undefined,
  durationSeconds: undefined,
};
const audio: probe.MediaInfo = {
  ...video,
  videoCodec: "unknown",
  width: undefined,
  height: undefined,
  audioCodec: "aac",
  audioStreamIndex: 1,
  audioChannels: 2,
};
const candidate: ResolvedSource = {
  title: "Official broadcast",
  mediaKind: "video",
  chapters: [],
  ffmpegInput: "https://video.example/live",
  audioInput: "https://audio.example/live",
  ffmpegInputHeaders: { Referer: "video" },
  audioInputHeaders: { Referer: "audio" },
  ffmpegInputOptions: ["-reconnect", "1"],
};
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const match = { ...lolMatch(), state: "inProgress" as const };
  const event = lolSportsEvent(match);
  const lol = new LolEsportsClient(async () =>
    Response.json({
      data: {
        esports: { events: [match], pages: { older: null, newer: null } },
      },
    }),
  );
  return {
    lol,
    source: {
      kind: "url" as const,
      url: event.pageUrl,
      sportsEvent: event,
      mode: "video" as const,
    },
  };
}

test.each([false, true])(
  "accepts split live video/audio, including pre-resolved sources (%s)",
  async (preResolved) => {
    const { lol, source } = fixture();
    const resolve = vi
      .spyOn(ytdlp, "resolveWithYtdlp")
      .mockResolvedValue(candidate);
    const inspect = vi
      .spyOn(probe, "probeMedia")
      .mockImplementation(async (_config, input) =>
        input === candidate.ffmpegInput ? video : audio,
      );
    const signal = AbortSignal.timeout(1000);
    const result = await resolveSource(config, source, signal, {
      lol,
      ...(preResolved ? { preResolved: candidate } : {}),
    });
    expect(result).toMatchObject({
      ffmpegInput: candidate.ffmpegInput,
      audioInput: candidate.audioInput,
      ffmpegVideoStreamIndex: 1,
      ffmpegAudioStreamIndex: 1,
      mediaKind: "video",
    });
    expect(result.discontinuousLive).toBeUndefined();
    expect(inspect).toHaveBeenCalledWith(
      config,
      candidate.ffmpegInput,
      signal,
      {
        headers: candidate.ffmpegInputHeaders,
        inputOptions: candidate.ffmpegInputOptions,
      },
    );
    expect(inspect).toHaveBeenCalledWith(config, candidate.audioInput, signal, {
      headers: candidate.audioInputHeaders,
    });
    expect(resolve).toHaveBeenCalledTimes(preResolved ? 0 : 1);
    const playback = prepareStream(
      result.ffmpegInput,
      buildVideoPrepareOptions({
        stream: config.stream,
        resolved: result,
        startSeconds: 0,
        volumePercent: 100,
        pipelineMode: "sw",
      }),
    );
    try {
      expect(playback.command.args).toContain("1:a:1");
      expect(playback.command.args).toContain("0:v:1");
      expect(playback.command.args).not.toContain("1:a:0");
    } finally {
      playback.command.kill("SIGKILL");
      playback.output.destroy();
      await Promise.allSettled([playback.promise]);
    }
    if (!preResolved)
      expect(resolve.mock.calls[0]?.[1]).toMatchObject({
        url: "https://www.youtube.com/watch?v=5fD8Ker-Bic",
      });
  },
);

test.each([
  null,
  { ...audio, audioChannels: 0 },
  { ...audio, audioCodec: "unknown" },
])(
  "rejects an unusable mapped audio companion even when the primary contains audio (%s)",
  async (companion) => {
    const { source } = fixture();
    vi.spyOn(probe, "probeMedia").mockImplementation(async (_config, input) =>
      input === candidate.ffmpegInput
        ? { ...video, audioCodec: "aac", audioChannels: 2 }
        : companion,
    );
    await expect(
      resolveSource(config, source, AbortSignal.timeout(1000), {
        preResolved: candidate,
      }),
    ).rejects.toThrow("did not provide both audio and video");
  },
);

test("falls back to the muxed Twitch stream when YouTube's companion has no audio", async () => {
  const { lol, source } = fixture();
  const resolve = vi
    .spyOn(ytdlp, "resolveWithYtdlp")
    .mockResolvedValueOnce(candidate)
    .mockResolvedValueOnce({
      title: "Twitch",
      mediaKind: "video",
      chapters: [],
      ffmpegInput: "https://twitch.example/live",
    });
  vi.spyOn(probe, "probeMedia").mockImplementation(async (_config, input) => {
    if (input === candidate.ffmpegInput) return video;
    return input === candidate.audioInput
      ? { ...audio, audioChannels: 0 }
      : { ...video, audioCodec: "aac", audioChannels: 2 };
  });
  const result = await resolveSource(
    config,
    source,
    AbortSignal.timeout(1000),
    { lol },
  );
  expect(result.ffmpegInput).toBe("https://twitch.example/live");
  expect(result.discontinuousLive).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(resolve.mock.calls[1]?.[1]).toMatchObject({
    url: "https://www.twitch.tv/riotgames",
  });
});
