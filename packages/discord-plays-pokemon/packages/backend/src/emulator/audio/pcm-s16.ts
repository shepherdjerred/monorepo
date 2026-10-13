/**
 * Convert the mixer's interleaved Float32 PCM to interleaved signed 16-bit
 * little-endian, the format the browser feed carries. Out-of-range samples
 * clip rather than wrap.
 */
export function float32ToS16le(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 4);
  const out = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    const value = pcm.readFloatLE(index * 4);
    const clipped = Math.max(-1, Math.min(1, value));
    out.writeInt16LE(Math.round(clipped * 0x7f_ff), index * 2);
  }
  return out;
}
