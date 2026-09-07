import { describe, expect, test } from "vitest";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  buildMusicPrepareOptions,
  buildVideoPrepareOptions,
} from "@shepherdjerred/streambot/streamer/prepare-options.ts";
import { streamerEnv as env } from "./streamer-test-fixtures.ts";

const stream = loadConfig(env()).stream;

const MUSIC: ResolvedSource = {
  title: "A Song",
  ffmpegInput: "https://media.invalid/audio.webm",
  mediaKind: "music",
  chapters: [],
};

const VIDEO: ResolvedSource = {
  title: "A Movie",
  ffmpegInput: "/videos/movie.mkv",
  mediaKind: "video",
  chapters: [],
};

describe("buildMusicPrepareOptions", () => {
  test("asks for audio and nothing else", () => {
    const options = buildMusicPrepareOptions({
      stream,
      resolved: MUSIC,
      startSeconds: 0,
      volumePercent: 100,
    });

    expect(options.audioOnly).toBe(true);
    expect(options.includeAudio).toBe(true);
    expect(options.bitrateAudio).toBe(stream.bitrateAudioKbps);
    // The whole video vocabulary is absent, not neutralised. `encoder` in particular is what makes
    // ffmpeg emit `-init_hw_device vaapi=…`, which fails at startup on a host with no /dev/dri.
    expect(options.encoder).toBeUndefined();
    expect(options.width).toBeUndefined();
    expect(options.height).toBeUndefined();
    expect(options.frameRate).toBeUndefined();
    expect(options.videoCodec).toBeUndefined();
    expect(options.bitrateVideo).toBeUndefined();
    expect(options.hardwareAcceleratedDecoding).toBeUndefined();
    expect(options.hardwarePipelineMode).toBeUndefined();
  });

  test("keeps readrate pacing, but never bursts an unprofiled transport", () => {
    const options = buildMusicPrepareOptions({
      stream,
      resolved: MUSIC,
      startSeconds: 0,
      volumePercent: 100,
    });

    expect(options.readrate).toBe(stream.readrate);
    // The burst makes `attachPipeline` set the lone AudioStream to `noSleep`, so 2.5 s would push
    // ~125 Opus packets back-to-back down the ordinary voice connection before pacing engages —
    // on the first audio a listener hears, over a path nobody has measured. This package requires
    // profiling real output before changing timing or buffers, so music stays paced until then.
    expect(options.readrateInitialBurst).toBeUndefined();
  });

  test("passes no audioVolume, because the mixer owns music gain", () => {
    // Setting it here as well would apply the user's volume twice — once in ffmpeg's output filter
    // and once again on the samples — and would also freeze it for the whole segment.
    for (const volumePercent of [0, 50, 100, 200]) {
      const options = buildMusicPrepareOptions({
        stream,
        resolved: MUSIC,
        startSeconds: 0,
        volumePercent,
      });
      expect(options.audioVolume).toBeUndefined();
    }
  });

  test("seeks only when the segment starts past zero", () => {
    expect(
      buildMusicPrepareOptions({
        stream,
        resolved: MUSIC,
        startSeconds: 0,
        volumePercent: 100,
      }).startTime,
    ).toBeUndefined();
    expect(
      buildMusicPrepareOptions({
        stream,
        resolved: MUSIC,
        startSeconds: 42,
        volumePercent: 100,
      }).startTime,
    ).toBe(42);
  });

  test("threads the primary input's HTTP headers", () => {
    const options = buildMusicPrepareOptions({
      stream,
      resolved: {
        ...MUSIC,
        ffmpegInputHeaders: { Referer: "https://x.invalid/" },
      },
      startSeconds: 0,
      volumePercent: 100,
    });
    expect(options.customHeaders).toEqual({ Referer: "https://x.invalid/" });
  });

  test("drops video-only requests that would make prepareStream throw", () => {
    // The control that stops the music builder from silently becoming "the video builder plus a
    // flag": `audioOnly` hard-throws on subtitleBurn and on inputColor "hdr", so a music item
    // carrying either must not have them forwarded.
    const options = buildMusicPrepareOptions({
      stream,
      resolved: {
        ...MUSIC,
        hdr: true,
        subtitle: { path: "/tmp/subs.srt", cleanupPath: "/tmp/subs.srt" },
      },
      startSeconds: 0,
      volumePercent: 100,
    });
    expect(options.subtitleBurn).toBeUndefined();
    expect(options.inputColor).toBeUndefined();
  });
});

/** The `audioVolume` a video segment would be built with at a given user-facing percentage. */
function gain(volumePercent: number): number | undefined {
  return buildVideoPrepareOptions({
    stream,
    resolved: VIDEO,
    startSeconds: 0,
    volumePercent,
    pipelineMode: "sw",
  }).audioVolume;
}

describe("buildVideoPrepareOptions", () => {
  test("keeps the hardware pipeline it always had", () => {
    const options = buildVideoPrepareOptions({
      stream,
      resolved: { ...VIDEO, hdr: true, subtitle: { path: "/tmp/s.srt" } },
      startSeconds: 30,
      volumePercent: 100,
      pipelineMode: "hw",
    });

    expect(options.audioOnly).toBeUndefined();
    expect(options.width).toBe(stream.width);
    expect(options.height).toBe(stream.height);
    expect(options.frameRate).toBe(stream.fps);
    expect(options.hardwareAcceleratedDecoding).toBe(true);
    expect(options.encoder).toBeDefined();
    expect(options.hardwarePipelineMode).toBeUndefined();
    expect(options.subtitleBurn).toEqual({ path: "/tmp/s.srt" });
    expect(options.inputColor).toBe("hdr");
    expect(options.startTime).toBe(30);
  });

  test("hw-upload asks for the upload pipeline, sw asks for no encoder", () => {
    expect(
      buildVideoPrepareOptions({
        stream,
        resolved: VIDEO,
        startSeconds: 0,
        volumePercent: 100,
        pipelineMode: "hw-upload",
      }).hardwarePipelineMode,
    ).toBe("upload");
    const software = buildVideoPrepareOptions({
      stream,
      resolved: VIDEO,
      startSeconds: 0,
      volumePercent: 100,
      pipelineMode: "sw",
    });
    expect(software.encoder).toBeUndefined();
    expect(software.hardwareAcceleratedDecoding).toBe(false);
  });

  test("passes the requested volume as a linear multiplier", () => {
    // The long-standing "volume set for the next video" reply was a promise about a value nothing
    // ever passed: `prepareOpts` carried no volume at all. These are the values that make it true.
    expect(gain(100)).toBe(1);
    expect(gain(50)).toBe(0.5);
    expect(gain(0)).toBe(0);
    expect(gain(200)).toBe(2);
  });

  test("carries a merged audio input with its own separately signed headers", () => {
    const options = buildVideoPrepareOptions({
      stream,
      resolved: {
        ...VIDEO,
        ffmpegInput: "https://media.invalid/video.mp4",
        ffmpegInputHeaders: { "User-Agent": "yt" },
        audioInput: "https://media.invalid/audio.m4a",
        audioInputHeaders: {
          "User-Agent": "yt",
          Referer: "https://x.invalid/",
        },
      },
      startSeconds: 0,
      volumePercent: 100,
      pipelineMode: "sw",
    });

    expect(options.customHeaders).toEqual({ "User-Agent": "yt" });
    expect(options.audioInput?.source).toBe("https://media.invalid/audio.m4a");
    expect(options.audioInput?.inputOptions).toEqual([
      "-headers",
      "User-Agent: yt\r\nReferer: https://x.invalid/",
    ]);
  });

  test("omits audioInput entirely for a muxed source", () => {
    const options = buildVideoPrepareOptions({
      stream,
      resolved: VIDEO,
      startSeconds: 0,
      volumePercent: 100,
      pipelineMode: "sw",
    });
    expect(options.audioInput).toBeUndefined();
    expect(options.customHeaders).toBeUndefined();
  });
});
