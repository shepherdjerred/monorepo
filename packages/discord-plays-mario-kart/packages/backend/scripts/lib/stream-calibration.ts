import { spawnSync } from "node:child_process";
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "#src/emulator/constants.ts";

const BYTES_PER_SAMPLE = 2;
const AUDIO_WINDOW_MS = 5;

export type CalibrationPulse = {
  sourceTimeMs: number;
  videoTimeMs: number;
  audioTimeMs: number;
  videoOffsetMs: number;
  audioOffsetMs: number;
  avOffsetMs: number;
};

export type CalibrationSummary = {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxAbsMs: number;
};

export type CalibrationReport = {
  pulses: CalibrationPulse[];
  videoOffset: CalibrationSummary;
  audioOffset: CalibrationSummary;
  avOffset: CalibrationSummary;
};

export function generateCalibrationPcm(opts: {
  durationMs: number;
  pulseTimesMs: readonly number[];
  audioDelayMs: number;
}): Buffer {
  const totalSamples = Math.ceil((opts.durationMs / 1000) * AUDIO_SAMPLE_RATE);
  const pcm = Buffer.alloc(totalSamples * AUDIO_CHANNELS * BYTES_PER_SAMPLE);
  const pulseSamples = Math.round(0.08 * AUDIO_SAMPLE_RATE);
  for (const pulseTimeMs of opts.pulseTimesMs) {
    const startSample = Math.round(
      ((pulseTimeMs + opts.audioDelayMs) / 1000) * AUDIO_SAMPLE_RATE,
    );
    let phase = 0;
    for (
      let offset = 0;
      offset < pulseSamples && startSample + offset < totalSamples;
      offset++
    ) {
      const progress = offset / pulseSamples;
      const frequencyHz = 800 + (3200 - 800) * progress;
      phase += (2 * Math.PI * frequencyHz) / AUDIO_SAMPLE_RATE;
      const value = Math.round(Math.sin(phase) * 12_000);
      const sample = startSample + offset;
      for (let channel = 0; channel < AUDIO_CHANNELS; channel++) {
        pcm.writeInt16LE(
          value,
          (sample * AUDIO_CHANNELS + channel) * BYTES_PER_SAMPLE,
        );
      }
    }
  }
  return pcm;
}

export function isCalibrationVideoPulse(opts: {
  frameIndex: number;
  frameRate: number;
  pulseTimesMs: readonly number[];
  videoDelayFrames: number;
}): boolean {
  const pulseWidthFrames = 3;
  for (const pulseTimeMs of opts.pulseTimesMs) {
    const startFrame =
      Math.round((pulseTimeMs / 1000) * opts.frameRate) + opts.videoDelayFrames;
    if (
      opts.frameIndex >= startFrame &&
      opts.frameIndex < startFrame + pulseWidthFrames
    ) {
      return true;
    }
  }
  return false;
}

export function detectVideoPulseTimes(opts: {
  grayscale: Uint8Array;
  frameBytes: number;
  frameRate: number;
  brightnessThreshold: number;
}): number[] {
  if (opts.frameBytes <= 0) throw new RangeError("frameBytes must be positive");
  if (opts.grayscale.byteLength % opts.frameBytes !== 0) {
    throw new Error("decoded video does not contain whole frames");
  }
  const pulseTimesMs: number[] = [];
  let active = false;
  const frames = opts.grayscale.byteLength / opts.frameBytes;
  for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
    const start = frameIndex * opts.frameBytes;
    let sum = 0;
    for (let i = start; i < start + opts.frameBytes; i++) {
      sum += opts.grayscale[i] ?? 0;
    }
    const bright = sum / opts.frameBytes >= opts.brightnessThreshold;
    if (bright && !active) {
      pulseTimesMs.push((frameIndex / opts.frameRate) * 1000);
    }
    active = bright;
  }
  return pulseTimesMs;
}

export function detectAudioPulseTimes(opts: {
  monoS16le: Uint8Array;
  sampleRate: number;
  rmsThreshold: number;
}): number[] {
  if (opts.monoS16le.byteLength % BYTES_PER_SAMPLE !== 0) {
    throw new Error("decoded audio does not contain whole s16le samples");
  }
  const samplesPerWindow = Math.max(
    1,
    Math.round((AUDIO_WINDOW_MS / 1000) * opts.sampleRate),
  );
  const view = new DataView(
    opts.monoS16le.buffer,
    opts.monoS16le.byteOffset,
    opts.monoS16le.byteLength,
  );
  const samples = opts.monoS16le.byteLength / BYTES_PER_SAMPLE;
  const pulseTimesMs: number[] = [];
  let active = false;
  for (
    let windowStart = 0;
    windowStart < samples;
    windowStart += samplesPerWindow
  ) {
    const windowEnd = Math.min(samples, windowStart + samplesPerWindow);
    let sumSquares = 0;
    for (let sample = windowStart; sample < windowEnd; sample++) {
      const value = view.getInt16(sample * BYTES_PER_SAMPLE, true);
      sumSquares += value * value;
    }
    const rms = Math.sqrt(sumSquares / (windowEnd - windowStart));
    const loud = rms >= opts.rmsThreshold;
    if (loud && !active) {
      pulseTimesMs.push((windowStart / opts.sampleRate) * 1000);
    }
    active = loud;
  }
  return pulseTimesMs;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error("cannot summarize zero values");
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.ceil(q * sorted.length) - 1;
  const value = sorted[Math.max(0, index)];
  if (value === undefined) throw new Error("quantile index was out of range");
  return value;
}

export function summarizeOffsets(
  values: readonly number[],
): CalibrationSummary {
  return {
    samples: values.length,
    p50Ms: quantile(values, 0.5),
    p95Ms: quantile(values, 0.95),
    maxAbsMs: Math.max(...values.map((value) => Math.abs(value))),
  };
}

export function buildCalibrationReport(opts: {
  sourceTimesMs: readonly number[];
  videoTimesMs: readonly number[];
  audioTimesMs: readonly number[];
}): CalibrationReport {
  if (
    opts.videoTimesMs.length !== opts.sourceTimesMs.length ||
    opts.audioTimesMs.length !== opts.sourceTimesMs.length
  ) {
    throw new Error(
      `marker detection mismatch: expected ${String(
        opts.sourceTimesMs.length,
      )}, video=${String(opts.videoTimesMs.length)}, audio=${String(
        opts.audioTimesMs.length,
      )}`,
    );
  }
  const pulses = opts.sourceTimesMs.map((sourceTimeMs, index) => {
    const videoTimeMs = opts.videoTimesMs[index];
    const audioTimeMs = opts.audioTimesMs[index];
    if (videoTimeMs === undefined || audioTimeMs === undefined) {
      throw new Error(`missing detected marker at index ${String(index)}`);
    }
    return {
      sourceTimeMs,
      videoTimeMs,
      audioTimeMs,
      videoOffsetMs: videoTimeMs - sourceTimeMs,
      audioOffsetMs: audioTimeMs - sourceTimeMs,
      avOffsetMs: audioTimeMs - videoTimeMs,
    };
  });
  return {
    pulses,
    videoOffset: summarizeOffsets(pulses.map((pulse) => pulse.videoOffsetMs)),
    audioOffset: summarizeOffsets(pulses.map((pulse) => pulse.audioOffsetMs)),
    avOffset: summarizeOffsets(pulses.map((pulse) => pulse.avOffsetMs)),
  };
}

function decode(args: readonly string[], maxBuffer: number): Uint8Array {
  const result = spawnSync("ffmpeg", args, {
    encoding: "buffer",
    maxBuffer,
  });
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg decode failed: ${Buffer.from(result.stderr).toString("utf8")}`,
    );
  }
  return new Uint8Array(result.stdout);
}

export function analyzeCalibrationNut(opts: {
  path: string;
  sourceTimesMs: readonly number[];
  frameRate: number;
}): CalibrationReport {
  const decodedWidth = 64;
  const decodedHeight = 24;
  const video = decode(
    [
      "-v",
      "error",
      "-i",
      opts.path,
      "-map",
      "0:v:0",
      "-vf",
      `scale=${String(decodedWidth)}:${String(decodedHeight)},format=gray`,
      "-f",
      "rawvideo",
      "-",
    ],
    64 * 1024 * 1024,
  );
  const audio = decode(
    [
      "-v",
      "error",
      "-i",
      opts.path,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-f",
      "s16le",
      "-",
    ],
    64 * 1024 * 1024,
  );
  return buildCalibrationReport({
    sourceTimesMs: opts.sourceTimesMs,
    videoTimesMs: detectVideoPulseTimes({
      grayscale: video,
      frameBytes: decodedWidth * decodedHeight,
      frameRate: opts.frameRate,
      brightnessThreshold: 180,
    }),
    audioTimesMs: detectAudioPulseTimes({
      monoS16le: audio,
      sampleRate: AUDIO_SAMPLE_RATE,
      rmsThreshold: 2000,
    }),
  });
}
