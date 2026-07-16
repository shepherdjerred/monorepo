// Read the captured source WAV and dump the analysis-suite numbers so we can
// reason about whether the engine is producing real music without afplay'ing
// from a non-interactive session.

import {
  bandEnergyRatio,
  fft,
  onsetCount,
  rms,
  stdDev,
  stft,
} from "#src/emulator/audio/analysis.ts";
import { decodeWav, s8StereoToMonoF64 } from "#src/emulator/audio/wav.ts";
import { logger } from "#src/logger.ts";

const WAV_PATH = new URL("out/audio-e2e-source.wav", import.meta.url).pathname;
const file = await Bun.file(WAV_PATH).bytes();
const wav = decodeWav(Buffer.from(file));
const mono = s8StereoToMonoF64(wav.pcm);

logger.info(`samples: ${String(mono.length)} @ ${String(wav.sampleRate)} Hz`);
logger.info(`duration: ${(mono.length / wav.sampleRate).toFixed(2)} s`);
logger.info(`overall RMS:    ${rms(mono).toFixed(4)} (normalised; 0..1)`);
logger.info(`overall stdDev: ${stdDev(mono).toFixed(4)}`);

const sr = wav.sampleRate;
for (let t = 0; t < Math.floor(mono.length / sr); t++) {
  const slice = mono.subarray(t * sr, (t + 1) * sr);
  logger.info(
    `  t=${String(t)}s..${String(t + 1)}s RMS=${rms(slice).toFixed(4)}`,
  );
}

const win = 4096;
let bestStart = 0;
let bestRms = 0;
for (let s = 0; s + win <= mono.length; s += win / 2) {
  const r = rms(mono.subarray(s, s + win));
  if (r > bestRms) {
    bestRms = r;
    bestStart = s;
  }
}
logger.info(
  `loudest ${String(win)}-sample window: start=${String(bestStart)} RMS=${bestRms.toFixed(4)}`,
);
const re = new Float64Array(win);
const im = new Float64Array(win);
for (let i = 0; i < win; i++) re[i] = mono[bestStart + i] ?? 0;
fft(re, im);
const mag = new Float64Array(win / 2);
for (let i = 0; i < mag.length; i++)
  mag[i] = Math.hypot(re[i] ?? 0, im[i] ?? 0);
logger.info(
  `  band 200 Hz-8 kHz: ${(bandEnergyRatio(mag, sr, 200, 8000) * 100).toFixed(1)}%`,
);
logger.info(
  `  band 0-200 Hz (DC): ${(bandEnergyRatio(mag, sr, 0, 200) * 100).toFixed(1)}%`,
);

const peaks: { hz: number; mag: number }[] = [];
for (let k = 1; k < mag.length - 1; k++) {
  const cur = mag[k];
  const prev = mag[k - 1];
  const next = mag[k + 1];
  if (cur === undefined || prev === undefined || next === undefined) {
    throw new Error(`Magnitude index out of range at bin ${String(k)}`);
  }
  if (cur > prev && cur > next && cur > 0.1) {
    peaks.push({ hz: (k * sr) / win, mag: cur });
  }
}
peaks.sort((a, b) => b.mag - a.mag);
for (const p of peaks.slice(0, 8)) {
  logger.info(`  peak ${p.hz.toFixed(0)} Hz mag=${p.mag.toFixed(2)}`);
}

const stftFrames = stft(
  mono.subarray(bestStart),
  Math.min(1024, mono.length - bestStart),
  256,
);
logger.info(
  `onset count over loudest region: ${String(onsetCount(stftFrames))}`,
);
