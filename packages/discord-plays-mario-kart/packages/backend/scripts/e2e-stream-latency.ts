#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { prepareStream, Encoders } from "@shepherdjerred/discord-video-stream";
import { createAudioTransport } from "#src/stream/audio-transport.ts";
import { HEIGHT, N64_FPS, WIDTH } from "#src/emulator/constants.ts";
import {
  analyzeCalibrationNut,
  generateCalibrationPcm,
  isCalibrationVideoPulse,
} from "./lib/stream-calibration.ts";

const DURATION_MS = 8000;
const PULSE_TIMES_MS = [2000, 4000, 6000] as const;
const DEFAULT_NUT = "/tmp/mk64-stream-latency.nut";
const DEFAULT_REPORT = "/tmp/mk64-stream-latency.json";

type Options = {
  nutPath: string;
  reportPath: string;
  audioDelayMs: number;
  videoDelayFrames: number;
};

function parseNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${flag} requires a finite number`);
  }
  return parsed;
}

function parseArgs(args: readonly string[]): Options {
  let nutPath = DEFAULT_NUT;
  let reportPath = DEFAULT_REPORT;
  let audioDelayMs = 0;
  let videoDelayFrames = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      throw new TypeError("argument must be defined");
    }
    switch (arg) {
      case "--out":
        nutPath = args[++i] ?? "";
        if (nutPath.length === 0) {
          throw new TypeError("--out requires a path");
        }
        break;
      case "--report":
        reportPath = args[++i] ?? "";
        if (reportPath.length === 0) {
          throw new TypeError("--report requires a path");
        }
        break;
      case "--audio-delay-ms":
        audioDelayMs = parseNumber(args[++i], "--audio-delay-ms");
        break;
      case "--video-delay-frames":
        videoDelayFrames = parseNumber(args[++i], "--video-delay-frames");
        if (!Number.isInteger(videoDelayFrames)) {
          throw new TypeError("--video-delay-frames requires an integer");
        }
        break;
      default:
        throw new TypeError(`unknown argument: ${arg}`);
    }
  }
  return { nutPath, reportPath, audioDelayMs, videoDelayFrames };
}

function requireFfmpeg(): void {
  for (const binary of ["ffmpeg", "ffprobe"]) {
    const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`${binary} is required for stream latency calibration`);
    }
  }
}

async function tolerateExpectedEncoderExit(
  promise: Promise<void>,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/SIGKILL|signal 9|Exiting normally|code (?:0|255)/i.test(message)) {
      throw error;
    }
  }
}

async function encoderExitSignal(
  encoderPromise: Promise<unknown>,
): Promise<"encoder-exited"> {
  await encoderPromise;
  return "encoder-exited";
}

export async function waitForCalibrationVideoDrain(
  video: PassThrough,
  encoderPromise: Promise<unknown>,
): Promise<void> {
  const result = await Promise.race([
    once(video, "drain"),
    encoderExitSignal(encoderPromise),
  ]);
  if (result === "encoder-exited") {
    throw new Error("ffmpeg exited before calibration video input completed");
  }
}

async function renderCalibration(opts: Options): Promise<void> {
  const transport = await createAudioTransport();
  const video = new PassThrough();
  const { output, promise } = prepareStream(video, {
    width: WIDTH,
    height: HEIGHT,
    frameRate: N64_FPS,
    videoCodec: "H264",
    bitrateVideo: 1000,
    bitrateVideoMax: 1500,
    includeAudio: true,
    audioInput: {
      source: transport.source,
      inputOptions: transport.inputOptions,
    },
    minimizeLatency: true,
    customInputOptions: [
      "-f",
      "rawvideo",
      "-pix_fmt",
      "bgra",
      "-video_size",
      `${String(WIDTH)}x${String(HEIGHT)}`,
      "-framerate",
      String(N64_FPS),
      "-probesize",
      "32",
    ],
    encoder: Encoders.software({
      x264: { preset: "ultrafast", tune: "zerolatency" },
    }),
  });

  await Bun.write(opts.nutPath, "");
  const writer = Bun.file(opts.nutPath).writer();
  output.on("data", (chunk: Buffer) => {
    void writer.write(chunk);
  });

  const pcm = generateCalibrationPcm({
    durationMs: DURATION_MS,
    pulseTimesMs: PULSE_TIMES_MS,
    audioDelayMs: opts.audioDelayMs,
  });
  transport.sink.write(pcm);
  transport.sink.end();

  const frames = Math.ceil((DURATION_MS / 1000) * N64_FPS);
  const background = Buffer.alloc(WIDTH * HEIGHT * 4, 0x20);
  const pulse = Buffer.alloc(WIDTH * HEIGHT * 4, 0xff);
  for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
    const selected = isCalibrationVideoPulse({
      frameIndex,
      frameRate: N64_FPS,
      pulseTimesMs: PULSE_TIMES_MS,
      videoDelayFrames: opts.videoDelayFrames,
    })
      ? pulse
      : background;
    if (!video.write(selected)) {
      await waitForCalibrationVideoDrain(video, promise);
    }
  }
  video.end();
  await tolerateExpectedEncoderExit(promise);
  await writer.end();
  transport.close();
}

function format(value: number): string {
  return `${value.toFixed(1)} ms`;
}

async function main(): Promise<void> {
  const opts = parseArgs(Bun.argv.slice(2));
  requireFfmpeg();
  await renderCalibration(opts);
  const report = analyzeCalibrationNut({
    path: opts.nutPath,
    sourceTimesMs: PULSE_TIMES_MS,
    frameRate: N64_FPS,
  });
  await Bun.write(opts.reportPath, `${JSON.stringify(report, null, 2)}\n`);

  process.stdout.write(
    [
      "MK64 server-side stream calibration",
      `  markers             ${String(report.pulses.length)}`,
      `  video offset p50   ${format(report.videoOffset.p50Ms)}`,
      `  audio offset p50   ${format(report.audioOffset.p50Ms)}`,
      `  A/V offset p50     ${format(report.avOffset.p50Ms)} (positive = audio lags)`,
      `  A/V offset p95     ${format(report.avOffset.p95Ms)}`,
      `  A/V max absolute   ${format(report.avOffset.maxAbsMs)}`,
      `  NUT artifact       ${opts.nutPath}`,
      `  JSON report        ${opts.reportPath}`,
      "",
    ].join("\n"),
  );
}

if (import.meta.main) {
  await main();
}
