// Minimal WAV file writer/reader for the audio e2e harness. PCM only; no
// compressed formats. Reads and writes signed-16-bit and signed-8-bit
// stereo, which is enough for both the m4a engine's native s8 output and
// the fingerprint baseline.

const RIFF = 0x46_46_49_52; // "RIFF" (LE)
const WAVE = 0x45_56_41_57; // "WAVE"
const FMT = 0x20_74_6d_66; // "fmt "
const DATA = 0x61_74_61_64; // "data"

export type WavWriteOptions = {
  sampleRate: number;
  channels: number;
  bitsPerSample: 8 | 16;
};

export function encodeWav(
  pcm: Buffer | Uint8Array,
  opts: WavWriteOptions,
): Buffer {
  const { sampleRate, channels, bitsPerSample } = opts;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.writeUInt32LE(RIFF, 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.writeUInt32LE(WAVE, 8);
  buffer.writeUInt32LE(FMT, 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.writeUInt32LE(DATA, 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm).copy(buffer, 44);
  return buffer;
}

export type WavReadResult = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcm: Buffer;
};

export function decodeWav(file: Buffer): WavReadResult {
  if (file.readUInt32LE(0) !== RIFF || file.readUInt32LE(8) !== WAVE) {
    throw new Error("not a RIFF/WAVE file");
  }
  // Walk chunks starting at offset 12.
  let cur = 12;
  let fmt: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
  } | null = null;
  let pcm: Buffer | null = null;
  while (cur + 8 <= file.length) {
    const id = file.readUInt32LE(cur);
    const size = file.readUInt32LE(cur + 4);
    if (id === FMT) {
      fmt = {
        channels: file.readUInt16LE(cur + 10),
        sampleRate: file.readUInt32LE(cur + 12),
        bitsPerSample: file.readUInt16LE(cur + 22),
      };
    } else if (id === DATA) {
      pcm = file.subarray(cur + 8, cur + 8 + size);
    }
    cur += 8 + size + (size & 1);
  }
  if (fmt === null || pcm === null) {
    throw new Error("WAV missing fmt or data chunk");
  }
  return { ...fmt, pcm };
}

/** Convert interleaved s8 stereo PCM to a flat mono Float64Array (averaged).
 * Used by the analysis pipeline which only looks at one channel. */
export function s8StereoToMonoF64(pcm: Buffer | Uint8Array): Float64Array {
  const stereo = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  const frames = stereo.length / 2;
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const l = (stereo[i * 2] << 24) >> 24;
    const r = (stereo[i * 2 + 1] << 24) >> 24;
    out[i] = (l + r) / 2 / 128;
  }
  return out;
}

/** Convert interleaved s16le stereo to mono Float64Array (averaged, scaled to
 * [-1, 1]). */
export function s16StereoToMonoF64(pcm: Buffer): Float64Array {
  const frames = pcm.length / 4;
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const l = pcm.readInt16LE(i * 4);
    const r = pcm.readInt16LE(i * 4 + 2);
    out[i] = (l + r) / 2 / 32_768;
  }
  return out;
}
