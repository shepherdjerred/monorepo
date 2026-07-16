// Audio analysis helpers used by the Phase-5 fingerprint test. Self-contained
// (no new deps): minimal Cooley-Tukey FFT, mel filterbank, chroma binning,
// spectral-flux onset detection, cosine similarity. Designed for power-of-two
// windows over short clips (~5s), so allocations + math accuracy aren't
// critical — but the math is correct enough that "right song" comes out
// distinguishable from "noise" or "silence" with comfortable margin.

// Every index below is loop-bounded by the array's own length, so an
// out-of-range read signals a logic bug rather than expected data — fail fast
// instead of letting an undefined silently poison the DSP arithmetic.
function at(arr: Float64Array, index: number): number {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`audio analysis index out of range: ${String(index)}`);
  }
  return value;
}

/** In-place radix-2 Cooley-Tukey FFT. Window length must be a power of 2. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length) throw new Error("re and im length mismatch");
  if ((n & (n - 1)) !== 0) throw new Error("fft length must be a power of 2");
  // Bit-reverse permutation.
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [at(re, j), at(re, i)];
      [im[i], im[j]] = [at(im, j), at(im, i)];
    }
  }
  // Cooley-Tukey butterflies.
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const theta = (-2 * Math.PI) / size;
    const wRe = Math.cos(theta);
    const wIm = Math.sin(theta);
    for (let i = 0; i < n; i += size) {
      let zRe = 1;
      let zIm = 0;
      for (let k = 0; k < halfSize; k++) {
        const tRe =
          zRe * at(re, i + k + halfSize) - zIm * at(im, i + k + halfSize);
        const tIm =
          zRe * at(im, i + k + halfSize) + zIm * at(re, i + k + halfSize);
        const baseRe = at(re, i + k);
        const baseIm = at(im, i + k);
        re[i + k + halfSize] = baseRe - tRe;
        im[i + k + halfSize] = baseIm - tIm;
        re[i + k] = baseRe + tRe;
        im[i + k] = baseIm + tIm;
        const nzRe = zRe * wRe - zIm * wIm;
        const nzIm = zRe * wIm + zIm * wRe;
        zRe = nzRe;
        zIm = nzIm;
      }
    }
  }
}

/** Hann window for a given length. */
export function hann(len: number): Float64Array {
  const w = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)));
  }
  return w;
}

export type StftFrame = Float64Array; // magnitude spectrum, length = window/2

export function stft(
  samples: Float64Array,
  windowSize: number,
  hopSize: number,
): StftFrame[] {
  const w = hann(windowSize);
  const frames: StftFrame[] = [];
  const re = new Float64Array(windowSize);
  const im = new Float64Array(windowSize);
  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    for (let i = 0; i < windowSize; i++)
      re[i] = at(samples, start + i) * at(w, i);
    im.fill(0);
    fft(re, im);
    const mag = new Float64Array(windowSize / 2);
    for (let i = 0; i < mag.length; i++) {
      mag[i] = Math.hypot(at(re, i), at(im, i));
    }
    frames.push(mag);
  }
  return frames;
}

// ---- Mel filterbank ------------------------------------------------------

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

export type MelFilterbankOptions = {
  lowHz?: number;
  highHz?: number;
};

export function melFilterbank(
  nBins: number,
  fftSize: number,
  sampleRate: number,
  opts: MelFilterbankOptions = {},
): Float64Array[] {
  const lowHz = opts.lowHz ?? 80;
  const top = opts.highHz ?? sampleRate / 2;
  const lowMel = hzToMel(lowHz);
  const highMel = hzToMel(top);
  const points: number[] = [];
  for (let i = 0; i <= nBins + 1; i++) {
    points.push(melToHz(lowMel + ((highMel - lowMel) * i) / (nBins + 1)));
  }
  const binFreqs = points.map((hz) =>
    Math.floor(((fftSize + 1) * hz) / sampleRate),
  );
  const filters: Float64Array[] = [];
  for (let m = 1; m <= nBins; m++) {
    const filt = new Float64Array(fftSize / 2);
    const left = binFreqs[m - 1];
    const center = binFreqs[m];
    const right = binFreqs[m + 1];
    if (left === undefined || center === undefined || right === undefined) {
      throw new Error(`mel bin frequency out of range at filter ${String(m)}`);
    }
    for (let k = left; k < center; k++) {
      if (center === left) continue;
      filt[k] = (k - left) / (center - left);
    }
    for (let k = center; k < right; k++) {
      if (right === center) continue;
      filt[k] = (right - k) / (right - center);
    }
    filters.push(filt);
  }
  return filters;
}

/** Apply a filterbank to one spectrum frame; returns nBins energies. */
export function applyFilterbank(
  spectrum: Float64Array,
  filters: Float64Array[],
): Float64Array {
  const out = new Float64Array(filters.length);
  for (const [m, f] of filters.entries()) {
    let s = 0;
    for (let k = 0; k < f.length; k++) s += at(spectrum, k) * at(f, k);
    out[m] = s;
  }
  return out;
}

// ---- Chroma (12-bin pitch class) -----------------------------------------

/** Map FFT bins to one of 12 pitch classes via equal temperament, ignoring
 * the bottom 80 Hz to avoid DC contamination. */
export function chromagram(
  spectrum: Float64Array,
  sampleRate: number,
): Float64Array {
  const fftSize = spectrum.length * 2;
  const chroma = new Float64Array(12);
  for (let k = 1; k < spectrum.length; k++) {
    const hz = (k * sampleRate) / fftSize;
    if (hz < 80 || hz > 5000) continue;
    const midi = 69 + 12 * Math.log2(hz / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] = at(chroma, pc) + at(spectrum, k);
  }
  return chroma;
}

// ---- Onset detection (spectral flux) -------------------------------------

/** Return the count of frames whose spectral-flux exceeds a per-clip threshold
 * (mean + sigma * std-dev). 1.5 sigma is a reasonable default for music. */
export function onsetCount(spectra: StftFrame[], sigma = 1.5): number {
  if (spectra.length < 2) return 0;
  const flux = new Float64Array(spectra.length - 1);
  for (let i = 1; i < spectra.length; i++) {
    let s = 0;
    const prev = spectra[i - 1];
    const cur = spectra[i];
    if (prev === undefined || cur === undefined) {
      throw new Error(`spectra frame out of range at ${String(i)}`);
    }
    for (const [k, element] of cur.entries()) {
      const d = element - at(prev, k);
      if (d > 0) s += d;
    }
    flux[i - 1] = s;
  }
  let mean = 0;
  for (const v of flux) mean += v;
  mean /= flux.length;
  let varAcc = 0;
  for (const v of flux) varAcc += (v - mean) ** 2;
  const std = Math.sqrt(varAcc / flux.length);
  const threshold = mean + sigma * std;
  let count = 0;
  for (const v of flux) if (v > threshold) count++;
  return count;
}

// ---- Cosine similarity ---------------------------------------------------

export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = at(a, i);
    const bv = at(b, i);
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mean cosine similarity between two equal-length sequences of feature
 * vectors (e.g. mel-spectrograms). The shorter sequence determines the
 * comparison length so partial-clip mismatches don't get a free pass. */
export function meanFrameCosine(a: Float64Array[], b: Float64Array[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) {
      throw new Error(`frame index out of range at ${String(i)}`);
    }
    acc += cosineSimilarity(av, bv);
  }
  return acc / n;
}

// ---- Floor checks --------------------------------------------------------

/** Root-mean-square amplitude on a signed-byte-range signal. */
export function rms(samples: Float64Array): number {
  if (samples.length === 0) return 0;
  let acc = 0;
  for (const v of samples) acc += v * v;
  return Math.sqrt(acc / samples.length);
}

export function stdDev(samples: Float64Array): number {
  if (samples.length === 0) return 0;
  let mean = 0;
  for (const v of samples) mean += v;
  mean /= samples.length;
  let acc = 0;
  for (const v of samples) acc += (v - mean) ** 2;
  return Math.sqrt(acc / samples.length);
}

/** Fraction of total spectral energy that falls in `[lowHz, highHz]`. */
export function bandEnergyRatio(
  spectrum: Float64Array,
  sampleRate: number,
  lowHz: number,
  highHz: number,
): number {
  const fftSize = spectrum.length * 2;
  let total = 0;
  let inBand = 0;
  for (let k = 1; k < spectrum.length; k++) {
    const hz = (k * sampleRate) / fftSize;
    const e = at(spectrum, k) * at(spectrum, k);
    total += e;
    if (hz >= lowHz && hz <= highHz) inBand += e;
  }
  if (total === 0) return 0;
  return inBand / total;
}
