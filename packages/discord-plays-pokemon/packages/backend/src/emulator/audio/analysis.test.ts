import { describe, expect, test } from "bun:test";

import {
  applyFilterbank,
  bandEnergyRatio,
  chromagram,
  cosineSimilarity,
  fft,
  meanFrameCosine,
  melFilterbank,
  onsetCount,
  rms,
  stdDev,
  stft,
} from "./analysis.ts";

/**
 * Sanity tests for the audio analysis helpers. They exercise the math against
 * synthetic signals (pure sine, white noise, silence) so the Phase 5 mel/
 * chroma/onset gates we run against the m4a engine are anchored on something
 * we can independently reason about.
 */

const SR = 48_000;
const WIN = 1024;

function sine(
  freqHz: number,
  lenSamples: number,
  sampleRate = SR,
): Float64Array {
  const out = new Float64Array(lenSamples);
  for (let i = 0; i < lenSamples; i++) {
    out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

function noise(lenSamples: number, seed = 1): Float64Array {
  // Tiny deterministic PRNG so noise is reproducible.
  let s = seed;
  const out = new Float64Array(lenSamples);
  for (let i = 0; i < lenSamples; i++) {
    s = (s * 1_103_515_245 + 12_345) & 0x7f_ff_ff_ff;
    out[i] = s / 0x40_00_00_00 - 1;
  }
  return out;
}

describe("FFT", () => {
  test("pure sine peaks at the correct bin", () => {
    const re = sine(1000, WIN);
    const im = new Float64Array(WIN);
    fft(re, im);
    const mag = new Float64Array(WIN / 2);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]);
    let peakIdx = 0;
    let peakMag = 0;
    for (const [i, element] of mag.entries()) {
      if (element > peakMag) {
        peakMag = element;
        peakIdx = i;
      }
    }
    const peakHz = (peakIdx * SR) / WIN;
    // Within one FFT bin of 1000 Hz.
    expect(Math.abs(peakHz - 1000)).toBeLessThan(SR / WIN);
  });
});

describe("Mel + chroma fingerprints", () => {
  test("two clips of the same sine match; different sines don't", () => {
    const filters = melFilterbank(32, WIN, SR);
    const a = stft(sine(440, SR * 1), WIN, 256).map((s) =>
      applyFilterbank(s, filters),
    );
    const b = stft(sine(440, SR * 1), WIN, 256).map((s) =>
      applyFilterbank(s, filters),
    );
    const c = stft(sine(880, SR * 1), WIN, 256).map((s) =>
      applyFilterbank(s, filters),
    );
    expect(meanFrameCosine(a, b)).toBeGreaterThan(0.99);
    expect(meanFrameCosine(a, c)).toBeLessThan(0.5);
  });

  test("chroma concentrates a pure sine in one pitch class", () => {
    const a = stft(sine(440, SR), WIN, 256);
    const chroma = chromagram(a[a.length >> 1], SR);
    // Pure sine should put most energy in 1-2 adjacent pitch classes (FFT
    // bin granularity + windowing leakage). Verify peak/total > 0.4.
    let total = 0;
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      // loop is bounded by the fixed 12-bin chroma length; ?? 0 satisfies
      // noUncheckedIndexedAccess without changing the sum
      const bin = chroma[i] ?? 0;
      total += bin;
      if (bin > peak) peak = bin;
    }
    expect(peak / total).toBeGreaterThan(0.4);
  });
});

describe("Onset detection + floor checks", () => {
  test("noise has many onsets, silence has none", () => {
    const noiseSpectra = stft(noise(SR), WIN, 256);
    const silenceSpectra = stft(new Float64Array(SR), WIN, 256);
    expect(onsetCount(noiseSpectra)).toBeGreaterThan(5);
    expect(onsetCount(silenceSpectra)).toBe(0);
  });

  test("RMS distinguishes silence from signal", () => {
    expect(rms(new Float64Array(1024))).toBe(0);
    expect(rms(sine(440, 1024))).toBeGreaterThan(0.5);
  });

  test("std-dev catches constant-non-zero buffers", () => {
    const dcOnly = new Float64Array(1024).fill(0.5);
    expect(stdDev(dcOnly)).toBeCloseTo(0, 6);
    expect(stdDev(sine(440, 1024))).toBeGreaterThan(0.5);
  });

  test("cosine similarity is 1 for identical, ~0 for orthogonal", () => {
    const a = new Float64Array([1, 0, 0, 1]);
    const b = new Float64Array([1, 0, 0, 1]);
    const c = new Float64Array([0, 1, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    expect(Math.abs(cosineSimilarity(a, c))).toBeLessThan(0.01);
  });

  test("band energy ratio concentrates on the source frequency", () => {
    const sineSig = sine(2000, WIN);
    const re = new Float64Array(WIN);
    const im = new Float64Array(WIN);
    for (let i = 0; i < WIN; i++) re[i] = sineSig[i];
    fft(re, im);
    const mag = new Float64Array(WIN / 2);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]);
    expect(bandEnergyRatio(mag, SR, 1500, 2500)).toBeGreaterThan(0.9);
    expect(bandEnergyRatio(mag, SR, 5000, 10_000)).toBeLessThan(0.1);
  });
});
