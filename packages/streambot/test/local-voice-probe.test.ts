import { describe, expect, test } from "bun:test";
import {
  buildAvfoundationCaptureCommand,
  DryRunVoiceCommandPort,
  LocalVoiceProbe,
  parseAvfoundationAudioDevices,
  startMacMicrophoneCapture,
} from "@shepherdjerred/streambot/voice/local-voice-probe.ts";
import type { LocalVoiceModels } from "@shepherdjerred/streambot/voice/local-models.ts";
import { VoiceConfigSchema } from "@shepherdjerred/streambot/config/schema.ts";

function markerModels(wake: boolean): LocalVoiceModels {
  return {
    runtime: "native",
    createKeywordDetector: () => ({
      accept: (samples) =>
        wake && samples.some((sample) => Math.abs(sample) > 0.01)
          ? {
              detector: "sherpa",
              phrase: "HEY",
              score: null,
              fragmentEndSeconds: null,
            }
          : null,
      reset: () => {
        /* Stateless test detector. */
      },
      close: () => {
        /* No native handle. */
      },
    }),
    createVad: () => {
      let speech = false;
      let silenceFrames = 0;
      let completed = false;
      return {
        accept: (samples) => {
          const hasEnergy = samples.some((sample) => Math.abs(sample) > 0.01);
          if (hasEnergy) {
            speech = true;
            silenceFrames = 0;
          } else if (speech) {
            silenceFrames += 1;
            if (silenceFrames >= 3) completed = true;
          }
        },
        isSpeechActive: () => speech,
        hasCompletedSpeech: () => completed,
        flush: () => {
          if (speech) completed = true;
        },
        reset: () => {
          speech = false;
          silenceFrames = 0;
          completed = false;
        },
        close: () => {
          /* No native handle. */
        },
      };
    },
    verifyWakePhrase: () => Promise.resolve({ accepted: true, score: 0.9 }),
    close: () => Promise.resolve(),
  };
}

function tonePcm24k(durationMs: number): Uint8Array {
  const samples = Math.floor((24_000 * durationMs) / 1000);
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(
      Math.sin((2 * Math.PI * 440 * index) / 24_000) * 12_000,
    );
    view.setInt16(index * 2, value, true);
  }
  return bytes;
}

const config = VoiceConfigSchema.parse({
  enabled: true,
  openAiApiKey: "test-key",
});

describe("local voice probe", () => {
  test("parses only AVFoundation audio devices", () => {
    const output = `[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] MacBook Pro Camera
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [0] AirPods Pro
[AVFoundation indev @ 0x1] [1] MacBook Pro Microphone
Error opening input files: Input/output error`;
    expect(parseAvfoundationAudioDevices(output)).toEqual([
      { index: 0, name: "AirPods Pro" },
      { index: 1, name: "MacBook Pro Microphone" },
    ]);
  });

  test("constructs a 24 kHz mono PCM AVFoundation command without stdin", () => {
    expect(
      buildAvfoundationCaptureCommand("/opt/homebrew/bin/ffmpeg", 2),
    ).toEqual([
      "/opt/homebrew/bin/ffmpeg",
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-f",
      "avfoundation",
      "-i",
      ":2",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "s16le",
      "pipe:1",
    ]);
  });

  test("terminates and drains the FFmpeg microphone process exactly once", async () => {
    const exited = Promise.withResolvers<number>();
    let closeStdout: (() => void) | null = null;
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        closeStdout = () => controller.close();
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const chunks: Uint8Array[] = [];
    let kills = 0;
    const capture = startMacMicrophoneCapture({
      ffmpegPath: "ffmpeg",
      deviceIndex: 1,
      onPcm: (chunk) => chunks.push(chunk),
      spawn: () => ({
        stdout,
        stderr,
        exited: exited.promise,
        kill: () => {
          kills += 1;
          closeStdout?.();
          exited.resolve(143);
        },
      }),
    });

    await capture.stop();
    await capture.stop();
    expect(kills).toBe(1);
    expect(chunks).toEqual([new Uint8Array([1, 2, 3, 4])]);
  });

  test("routes microphone PCM through real Discord Opus before one turn", async () => {
    const commands = new DryRunVoiceCommandPort();
    const pcm = tonePcm24k(500);
    let turns = 0;
    const delivered: { pcm: Float32Array | null } = { pcm: null };
    const probe = new LocalVoiceProbe({
      config,
      models: markerModels(true),
      commands,
      runTurn: (turn) => {
        turns += 1;
        delivered.pcm = turn.pcm16k;
        return Promise.resolve({
          transcript: "Hey Streambot, skip.",
          wakeVerified: true,
          mutated: true,
        });
      },
    });
    probe.acceptPcm24k(pcm);
    const result = await probe.finish();

    expect(result).toEqual({
      outcome: "completed",
      transcript: "Hey Streambot, skip.",
      wakeVerified: true,
      invocations: [],
      stages: {
        sherpaCandidate: true,
        localVerified: true,
        openAiContacted: true,
        transcriptVerified: true,
      },
    });
    expect(turns).toBe(1);
    expect(pcm.every((byte) => byte === 0)).toBe(true);
    if (delivered.pcm === null) throw new Error("Expected one delivered turn");
    expect(delivered.pcm.every((sample) => sample === 0)).toBe(true);
    probe.close();
  });

  test("does not construct a Realtime turn without a wake", async () => {
    const commands = new DryRunVoiceCommandPort();
    let turns = 0;
    const probe = new LocalVoiceProbe({
      config,
      models: markerModels(false),
      commands,
      runTurn: () => {
        turns += 1;
        return Promise.resolve({
          transcript: null,
          wakeVerified: false,
          mutated: false,
        });
      },
    });
    probe.acceptPcm24k(tonePcm24k(200));
    expect(await probe.finish()).toEqual({
      outcome: "no-wake",
      stages: {
        sherpaCandidate: false,
        localVerified: false,
        openAiContacted: false,
        transcriptVerified: false,
      },
    });
    expect(turns).toBe(0);
    probe.close();
  });

  test("records every typed dry-run command without playback state", async () => {
    const commands = new DryRunVoiceCommandPort();
    const signal = new AbortController().signal;
    await commands.play(
      { query: "Movie", source: "youtube", placement: "next" },
      signal,
    );
    await commands.skip();
    await commands.stop();
    await commands.seek({ seconds: -30, mode: "relative" });
    await commands.setVolume(75);
    await commands.setLoop("queue");
    await commands.shuffle();
    await commands.getQueue();
    await commands.getNowPlaying();
    expect(commands.invocations.map((item) => item.name)).toEqual([
      "play",
      "skip",
      "stop",
      "seek",
      "set_volume",
      "set_loop",
      "shuffle",
      "get_queue",
      "get_now_playing",
    ]);
    commands.clear();
    expect(commands.invocations).toEqual([]);
  });

  test("shares production URL refusal without constructing playback", () => {
    const commands = new DryRunVoiceCommandPort();
    const signal = new AbortController().signal;
    expect(() =>
      commands.play(
        {
          query: "https://youtube.com/watch?v=not-accepted",
          source: "youtube",
          placement: "queue",
        },
        signal,
      ),
    ).toThrow("Say a title instead of a URL.");
    expect(commands.invocations).toEqual([]);
  });
});
