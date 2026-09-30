import { describe, expect, test } from "vitest";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import type { PlayerFactory } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type {
  ResolvedSource,
  RunStreamInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { EnvLookup } from "@shepherdjerred/streambot/config/index.ts";
import { createStreamObserver } from "@shepherdjerred/streambot/observability/stream-observer.ts";
import { buildVoiceJoinOptions } from "@shepherdjerred/streambot/streamer/join-voice.ts";
import { streamSegmentsTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import {
  STREAMER_USER_TOKEN as USER_TOKEN,
  STREAMER_VOICE as VOICE,
  streamerEnv as env,
} from "./streamer-test-fixtures.ts";

const SUBTITLE_PATH = "/tmp/streambot-subs/test-pipeline.srt";
const RESOLVED_HDR_WITH_SUBS: ResolvedSource = {
  title: "Movie",
  ffmpegInput: "/videos/movie.mkv",
  mediaKind: "video",
  chapters: [],
  subtitle: { path: SUBTITLE_PATH, cleanupPath: SUBTITLE_PATH },
  hdr: true,
};

type PrepareSnapshot = {
  hardwareAcceleratedDecoding: boolean | undefined;
  hardwarePipelineMode: string | undefined;
  hasEncoder: boolean;
  subtitleBurn: { path: string } | undefined;
  inputColor: string | undefined;
  audioOnly: boolean | undefined;
  audioVolume: number | undefined;
  playType: string | undefined;
  hasAudioSink: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/**
 * Fake player factory recording the prepare options each ffmpeg attempt would receive.
 * `startErrors[i]` makes attempt i's `start()` reject (the startup-failure path that triggers the
 * in-streamer software fallback — rejecting `finished` instead models a mid-stream crash, which
 * propagates to the machine).
 */
function makeFakeFactory(startErrors: (Error | undefined)[] = []) {
  const attempts: PrepareSnapshot[] = [];
  const factory: PlayerFactory = (_streamer, _input, options) => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const startError = startErrors[attempts.length];
    attempts.push({
      hardwareAcceleratedDecoding:
        options?.prepare?.hardwareAcceleratedDecoding,
      hardwarePipelineMode: options?.prepare?.hardwarePipelineMode,
      hasEncoder: options?.prepare?.encoder !== undefined,
      subtitleBurn: options?.prepare?.subtitleBurn,
      inputColor: options?.prepare?.inputColor,
      audioOnly: options?.prepare?.audioOnly,
      audioVolume: options?.prepare?.audioVolume,
      playType: options?.play?.type,
      hasAudioSink: options?.play?.audioSink !== undefined,
      resolve,
      reject,
    });
    return {
      start: () =>
        startError === undefined
          ? Promise.resolve()
          : Promise.reject(startError),
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

/**
 * Mark a run's rejection handled without consuming it.
 *
 * A startup failure rejects during the `flush()` below, before the caller has had a chance to
 * await, and Vitest reports that window as an unhandled rejection. The returned promise is still
 * the real one, so a test that forgets to assert on it still fails.
 */
async function markHandled(run: Promise<void>): Promise<void> {
  try {
    await run;
  } catch {
    /* the caller asserts on `run` itself */
  }
}

async function startPipelineRun(options: {
  pipelineMode: RunStreamInput["pipelineMode"];
  resolved?: ResolvedSource;
  startErrors?: (Error | undefined)[];
  volume?: number;
}) {
  const { factory, attempts } = makeFakeFactory(options.startErrors);
  const observerCalls: (boolean | undefined)[] = [];
  const streamer = new StreambotStreamer(
    USER_TOKEN,
    loadConfig(env({ STREAM_HARDWARE_ACCELERATION: "true" })),
    () => 0,
    {
      createPlayer: factory,
      createObserver: (hardware, now, onStall, observerOptions) => {
        observerCalls.push(observerOptions?.audioOnly);
        return createStreamObserver(hardware, now, onStall, observerOptions);
      },
    },
  );
  const run = streamer.runStream(
    {
      voice: VOICE,
      resolved: options.resolved ?? RESOLVED_HDR_WITH_SUBS,
      volume: options.volume ?? 100,
      seekSeconds: 0,
      pipelineMode: options.pipelineMode,
    },
    new AbortController().signal,
  );
  void markHandled(run);
  await flush();
  return { attempts, run, streamer, observerCalls };
}

const MUSIC_SOURCE: ResolvedSource = {
  title: "A Song",
  ffmpegInput: "https://media.invalid/audio.webm",
  mediaKind: "music",
  chapters: [],
};

describe("StreambotStreamer pipeline options", () => {
  test("subtitles no longer force software: HW attempt carries subtitleBurn + inputColor hdr", async () => {
    const { attempts, run } = await startPipelineRun({ pipelineMode: "hw" });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.hardwareAcceleratedDecoding).toBe(true);
    expect(attempts[0]?.hardwarePipelineMode).toBeUndefined(); // full-GPU default
    expect(attempts[0]?.hasEncoder).toBe(true); // VAAPI encoder despite the subtitle burn
    expect(attempts[0]?.subtitleBurn).toEqual({ path: SUBTITLE_PATH });
    expect(attempts[0]?.inputColor).toBe("hdr");

    attempts[0]?.resolve();
    await run;
  });

  test("pipelineMode hw-upload threads hardwarePipelineMode upload with the VAAPI encoder", async () => {
    const { attempts, run } = await startPipelineRun({
      pipelineMode: "hw-upload",
    });

    expect(attempts[0]?.hardwareAcceleratedDecoding).toBe(true);
    expect(attempts[0]?.hardwarePipelineMode).toBe("upload");
    expect(attempts[0]?.hasEncoder).toBe(true);

    attempts[0]?.resolve();
    await run;
  });

  test("pipelineMode sw runs software even when hardware is enabled in config", async () => {
    const { attempts, run } = await startPipelineRun({ pipelineMode: "sw" });

    expect(attempts[0]?.hardwareAcceleratedDecoding).toBe(false);
    expect(attempts[0]?.hasEncoder).toBe(false);

    attempts[0]?.resolve();
    await run;
  });

  test("HW startup failure → SW retry keeps subtitleBurn and inputColor so the software graph tonemaps + burns", async () => {
    const { attempts, run } = await startPipelineRun({
      pipelineMode: "hw",
      startErrors: [new Error("overlay_vaapi unsupported")],
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.hardwareAcceleratedDecoding).toBe(false);
    expect(attempts[1]?.hasEncoder).toBe(false); // software encoder on the retry
    expect(attempts[1]?.subtitleBurn).toEqual({ path: SUBTITLE_PATH });
    expect(attempts[1]?.inputColor).toBe("hdr");

    attempts[1]?.resolve();
    await run;
  });

  test("SDR source without subtitles passes inputColor sdr and no subtitleBurn", async () => {
    const { attempts, run } = await startPipelineRun({
      pipelineMode: "hw",
      resolved: {
        title: "Movie",
        ffmpegInput: "/videos/m.mkv",
        mediaKind: "video",
        chapters: [],
      },
    });

    expect(attempts[0]?.subtitleBurn).toBeUndefined();
    expect(attempts[0]?.inputColor).toBe("sdr");

    attempts[0]?.resolve();
    await run;
  });
});

// The single most important assertion for a feature that can be globally disabled: the flag
// must reach the Discord voice join as receiveAudio, and default to off.
async function joinAndCaptureReceiveAudio(over: EnvLookup): Promise<boolean> {
  let received: boolean | null = null;
  const streamer = new StreambotStreamer(
    USER_TOKEN,
    loadConfig(env(over)),
    Date.now,
    {
      joinStreamerVoice: (options) => {
        received = options.receiveAudio;
        return Promise.resolve({
          lastVoiceCloseInfo: () => null,
          release: () => null,
          record: () => false,
          retain: () => ({
            lastVoiceCloseInfo: () => null,
            release: () => null,
          }),
        });
      },
    },
  );
  await streamer.joinVoice(VOICE);
  if (received === null) throw new Error("joinStreamerVoice was not called");
  return received;
}

describe("voice receive gate", () => {
  test("voice disabled (default) joins send-only", async () => {
    await expect(joinAndCaptureReceiveAudio({})).resolves.toBe(false);
  });

  test("voice enabled opts the join into receive audio", async () => {
    await expect(
      joinAndCaptureReceiveAudio({
        VOICE_ASSISTANT_ENABLED: "true",
        OPENAI_API_KEY: "test-key",
      }),
    ).resolves.toBe(true);
  });
});

/** Current value of the segment counter for one exact label set, or 0 when it has never fired. */
async function segmentCount(labels: {
  transport: string;
  hardware: string;
  outcome: string;
}): Promise<number> {
  const metric = await streamSegmentsTotal.get();
  return (
    metric.values.find(
      (sample) =>
        sample.labels.transport === labels.transport &&
        sample.labels.hardware === labels.hardware &&
        sample.labels.outcome === labels.outcome,
    )?.value ?? 0
  );
}

describe("transport dispatch by media kind", () => {
  test("music plays audio-only over the voice connection through the mixer", async () => {
    const { attempts, run } = await startPipelineRun({
      pipelineMode: "hw",
      resolved: MUSIC_SOURCE,
    });

    expect(attempts).toHaveLength(1);
    // The normal voice connection with plain microphone semantics, not a Go Live tile.
    expect(attempts[0]?.playType).toBe("voice");
    // And the mixer, not the connection, is what the pacer hands frames to.
    expect(attempts[0]?.hasAudioSink).toBe(true);
    expect(attempts[0]?.audioOnly).toBe(true);
    expect(attempts[0]?.hasEncoder).toBe(false);
    expect(attempts[0]?.hardwareAcceleratedDecoding).toBeUndefined();
    expect(attempts[0]?.subtitleBurn).toBeUndefined();
    expect(attempts[0]?.inputColor).toBeUndefined();

    attempts[0]?.resolve();
    await run;
  });

  test("video is unchanged: Go Live, no audio sink, no audioOnly", async () => {
    // The control. An over-broad music branch that also rewrote the video path would break
    // playback for every movie while every music assertion above stayed green.
    const { attempts, run } = await startPipelineRun({ pipelineMode: "hw" });

    expect(attempts[0]?.playType).toBe("go-live");
    expect(attempts[0]?.hasAudioSink).toBe(false);
    expect(attempts[0]?.audioOnly).toBeUndefined();
    expect(attempts[0]?.hasEncoder).toBe(true);
    expect(attempts[0]?.subtitleBurn).toEqual({ path: SUBTITLE_PATH });

    attempts[0]?.resolve();
    await run;
  });

  test("music never walks the encoder ladder, because it has no encoder", async () => {
    // `PipelineMode` is a video ladder. Retrying a song "in software" would announce a recovery
    // that means nothing, through CrashNotice to users and streamCrashesTotal{pipeline} to
    // operators, and would replay the segment for no reason.
    const { attempts, run } = await startPipelineRun({
      pipelineMode: "hw",
      resolved: MUSIC_SOURCE,
      startErrors: [new Error("yt-dlp url expired")],
    });

    await expect(run).rejects.toThrow("yt-dlp url expired");
    expect(attempts).toHaveLength(1);
  });

  test("a music segment suppresses the video-only observer gauges", async () => {
    const music = await startPipelineRun({
      pipelineMode: "hw",
      resolved: MUSIC_SOURCE,
    });
    expect(music.observerCalls).toEqual([true]);
    music.attempts[0]?.resolve();
    await music.run;

    const video = await startPipelineRun({ pipelineMode: "sw" });
    expect(video.observerCalls).toEqual([false]);
    video.attempts[0]?.resolve();
    await video.run;
  });

  test("the segment counter distinguishes the two transports", async () => {
    const before = await segmentCount({
      transport: "voice",
      hardware: "false",
      outcome: "ended",
    });
    const { attempts, run } = await startPipelineRun({
      pipelineMode: "hw",
      resolved: MUSIC_SOURCE,
    });
    attempts[0]?.resolve();
    await run;

    expect(
      await segmentCount({
        transport: "voice",
        hardware: "false",
        outcome: "ended",
      }),
    ).toBe(before + 1);
  });
});

describe("volume reaches the audio for both transports", () => {
  test("music applies gain live and says so", async () => {
    const { attempts, run, streamer } = await startPipelineRun({
      pipelineMode: "hw",
      resolved: MUSIC_SOURCE,
    });

    // The user-visible half of the fix: `PlaybackControls` reports "Volume set" rather than the
    // permanent "for the next video" it was stuck on, because this is now genuinely live.
    await expect(streamer.setVolume(50)).resolves.toBe(true);
    // And the mixer, not ffmpeg, holds it — a music segment must not also carry an audioVolume,
    // or the gain would be applied twice.
    expect(attempts[0]?.audioVolume).toBeUndefined();

    attempts[0]?.resolve();
    await run;
    await expect(streamer.setVolume(50)).resolves.toBe(false);
  });

  test("video bakes the requested volume into its ffmpeg command", async () => {
    const { attempts, run, streamer } = await startPipelineRun({
      pipelineMode: "sw",
      volume: 40,
    });

    expect(attempts[0]?.audioVolume).toBe(0.4);
    // Still deferred for Go Live: the gain is fixed for the life of the segment, so the reply the
    // user gets ("for the next video") is now accurate rather than a permanent lie.
    await expect(streamer.setVolume(75)).resolves.toBe(false);

    attempts[0]?.resolve();
    await run;
  });

  test("unity renders as an unchanged command line", async () => {
    const { attempts, run } = await startPipelineRun({
      pipelineMode: "sw",
      volume: 100,
    });
    // The byte-identity constraint the fork's regression-lock tests pin: at 100% the emitted
    // filter is the literal `volume@internal_lib=1.0` this pipeline always carried.
    expect(attempts[0]?.audioVolume).toBe(1);
    attempts[0]?.resolve();
    await run;
  });
});

describe("voice join options", () => {
  test("send audio is requested unconditionally, independent of the receive gate", () => {
    // The packetizer is installed on `receiveAudio || sendAudio`, and without one every music
    // frame is dropped with a silent `false`. The join also happens before anything is resolved,
    // so this cannot be derived from the first item's kind.
    for (const receiveAudio of [false, true]) {
      expect(
        buildVoiceJoinOptions({ receiveAudio, receiveObserver: null }),
      ).toEqual({ receiveAudio, sendAudio: true });
    }
  });

  test("a receive observer is attached only when there is one", () => {
    const observer = {
      onPacket: () => {
        /* the join boundary only forwards the observer, never calls it */
      },
    };
    expect(
      buildVoiceJoinOptions({ receiveAudio: true, receiveObserver: observer }),
    ).toEqual({
      receiveAudio: true,
      sendAudio: true,
      receiveObserver: observer,
    });
  });
});
