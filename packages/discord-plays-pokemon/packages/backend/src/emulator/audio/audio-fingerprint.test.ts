// e2e regression gate for the wasm-side m4a engine.
//
// Boots the real `pokeemerald.wasm` via `Emulator`, captures ~15 s of PCM
// (covering boot + ~12 s of title-screen BGM), trims the silent intro the
// same way `scripts/audio-e2e.ts --update-baseline` does, then compares the
// captured spectrogram against the committed baseline at
// `src/__tests__/fixtures/title-bgm-baseline.wav`.
//
// The gate is three independent similarity metrics: mel cosine catches
// "different song" / "wrong sample rate" / "silence" / "noise"; chroma
// cosine catches subtle pitch-bend bugs that don't move spectral centroids;
// onset count catches tempo/timing regressions where the right notes play
// at the wrong rhythm. All three must pass for audio to be considered
// healthy.
//
// To regenerate the baseline (intentional audio change):
//
//   bun run scripts/audio-e2e.ts --update-baseline
//
// Then commit the updated WAV. Auto-skips when the wasm isn't built yet (e.g.
// plain `bun run test` on a clean checkout); force-skip with
// `SKIP_AUDIO_FINGERPRINT=1`.

import { describe, expect, test } from "bun:test";

import { Emulator } from "#src/emulator/emulator.ts";
import type { DrainResult } from "#src/emulator/audio/m4a-driver.ts";
import {
  applyFilterbank,
  chromagram,
  cosineSimilarity,
  meanFrameCosine,
  melFilterbank,
  onsetCount,
  rms,
  stft,
} from "#src/emulator/audio/analysis.ts";
import { decodeWav, f32StereoToMonoF64 } from "#src/emulator/audio/wav.ts";

// Capture parameters tuned to overlap the baseline window (15 s of game
// time → ~12 s of music after the silent intro). The fingerprint metrics
// look at the first `COMPARE_SECONDS` seconds of trimmed audio.
const CAPTURE_FRAMES = 900;
const COMPARE_SECONDS = 8;
// Float32 ±1.0 silence floor — matches what scripts/audio-e2e.ts uses to
// trim the silent intro before saving the baseline.
const SILENCE_THRESHOLD_F32 = 0.03;
// Mel/chroma + onset thresholds. Mel is the loudest signal (catches "wrong
// song"); chroma is invariant to gain (catches "right notes but quieter");
// onset is robust to tonal drift (catches "right notes wrong tempo").
const MEL_COSINE_MIN = 0.85;
const CHROMA_COSINE_MIN = 0.9;
const ONSET_TOLERANCE = 0.25; // ±25% — the s8 mixer + frame-pacing jitter
// produces ~10–15% run-to-run onset
// variance; widen so the gate doesn't
// flake on noise.
// FFT window for mel + chroma. 1024 @ 13379 Hz = ~77 ms window.
const FFT_WIN = 1024;
const FFT_HOP = 256;
const MEL_BINS = 32;

const WASM_PATH = new URL("../../../assets/pokeemerald.wasm", import.meta.url)
  .pathname;

async function captureClip(frames: number): Promise<{
  mono: Float64Array;
  sampleRate: number;
}> {
  const emulator = new Emulator({ wasmPath: WASM_PATH });
  await emulator.init();
  const drains: DrainResult[] = [];
  let rate = 0;
  emulator.onAudio((pcm) => {
    drains.push(pcm);
    if (rate === 0) rate = pcm.freqHz;
  });
  emulator.start();
  await new Promise<void>((resolve) => {
    const tick = (): void => {
      if (emulator.frame >= frames) {
        emulator.stop();
        resolve();
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
  // Trim leading silence (intro logos before the title BGM kicks in).
  const firstNoisy = drains.findIndex((r) => {
    let peak = 0;
    const fr = r.pcm.length / 8;
    for (let i = 0; i < fr; i++) {
      const l = Math.abs(r.pcm.readFloatLE(i * 8));
      const rr = Math.abs(r.pcm.readFloatLE(i * 8 + 4));
      if (l > peak) peak = l;
      if (rr > peak) peak = rr;
    }
    return peak > SILENCE_THRESHOLD_F32;
  });
  const start = firstNoisy === -1 ? 0 : firstNoisy;
  const trimmed = drains.slice(start);
  if (trimmed.length === 0) {
    throw new Error(`no audible PCM after ${String(frames)} frames`);
  }
  const concat = Buffer.concat(trimmed.map((r) => r.pcm));
  return { mono: f32StereoToMonoF64(concat), sampleRate: rate };
}

async function loadBaseline(): Promise<{
  mono: Float64Array;
  sampleRate: number;
}> {
  const path = new URL(
    "../../__tests__/fixtures/title-bgm-baseline.wav",
    import.meta.url,
  ).pathname;
  const bytes = await Bun.file(path).bytes();
  const wav = decodeWav(Buffer.from(bytes));
  return { mono: f32StereoToMonoF64(wav.pcm), sampleRate: wav.sampleRate };
}

function melFingerprint(
  mono: Float64Array,
  sampleRate: number,
): Float64Array[] {
  const frames = stft(mono, FFT_WIN, FFT_HOP);
  const filters = melFilterbank(MEL_BINS, FFT_WIN, sampleRate);
  return frames.map((s) => applyFilterbank(s, filters));
}

function chromaFingerprint(
  mono: Float64Array,
  sampleRate: number,
): Float64Array {
  // Average chromagram across all STFT frames — invariant to time-shift.
  const frames = stft(mono, FFT_WIN, FFT_HOP);
  const acc = new Float64Array(12);
  for (const frame of frames) {
    const c = chromagram(frame, sampleRate);
    for (let i = 0; i < 12; i++) acc[i] += c[i];
  }
  for (let i = 0; i < 12; i++) acc[i] /= frames.length;
  return acc;
}

// Skip when explicitly disabled, or when the wasm isn't present (plain
// `bun run test` on a clean checkout — the wasm is built from source in the
// Dagger image build and locally by scripts/build-wasm.sh, where this gate runs).
// `Bun.file().size` is synchronous and returns 0 for a missing file — used
// instead of node:fs (banned by the bun-runtime lint rule).
if (Bun.env.SKIP_AUDIO_FINGERPRINT === "1" || Bun.file(WASM_PATH).size === 0) {
  describe.skip("audio fingerprint (skipped: SKIP_AUDIO_FINGERPRINT or wasm not built)", () => {
    test("noop", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("audio fingerprint vs title-bgm-baseline.wav", () => {
    test("fresh PCM matches committed baseline across mel + chroma + onset", async () => {
      const baseline = await loadBaseline();
      const captured = await captureClip(CAPTURE_FRAMES);

      expect(captured.sampleRate).toBe(baseline.sampleRate);

      // Truncate both to the same comparison window so the metrics are
      // computed over equal-length signals.
      const n = Math.min(
        captured.mono.length,
        baseline.mono.length,
        COMPARE_SECONDS * baseline.sampleRate,
      );
      const a = captured.mono.subarray(0, n);
      const b = baseline.mono.subarray(0, n);

      // Floor: both clips should carry real audible energy.
      expect(rms(a)).toBeGreaterThan(0.02);
      expect(rms(b)).toBeGreaterThan(0.02);

      // Mel fingerprint — the strongest signal.
      const melA = melFingerprint(a, baseline.sampleRate);
      const melB = melFingerprint(b, baseline.sampleRate);
      const melCos = meanFrameCosine(melA, melB);
      expect(melCos).toBeGreaterThan(MEL_COSINE_MIN);

      // Chroma fingerprint — gain-invariant, catches pitch errors.
      const chromaA = chromaFingerprint(a, baseline.sampleRate);
      const chromaB = chromaFingerprint(b, baseline.sampleRate);
      const chromaCos = cosineSimilarity(chromaA, chromaB);
      expect(chromaCos).toBeGreaterThan(CHROMA_COSINE_MIN);

      // Onset count — tempo / rhythm.
      const onsetA = onsetCount(stft(a, FFT_WIN, FFT_HOP));
      const onsetB = onsetCount(stft(b, FFT_WIN, FFT_HOP));
      // Avoid divide-by-zero when the baseline happens to have zero
      // onsets (shouldn't, but fail loud if so).
      expect(onsetB).toBeGreaterThan(0);
      const onsetDelta = Math.abs(onsetA - onsetB) / onsetB;
      expect(onsetDelta).toBeLessThanOrEqual(ONSET_TOLERANCE);
    }, 120_000);
  });
}
