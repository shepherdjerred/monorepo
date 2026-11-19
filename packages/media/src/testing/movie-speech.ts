/** Deterministic harmonic vowel-like burst for real, non-neural VAD/timing tests.
 * This is generated audio, not a recording or provider speech provenance. */
export function movieSpeechWav() {
  const rate = 48_000;
  const samples = rate * 2;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  const start = Math.round(rate * 0.4);
  const count = Math.round(rate * 0.7);
  const voice = new Float64Array(count);
  let phase = 0;
  let maximum = 1;
  for (let index = 0; index < count; index += 1) {
    const time = index / rate;
    phase +=
      (2 * Math.PI * (115 + 25 * Math.sin(2 * Math.PI * 2.8 * time))) / rate;
    let value = 0;
    for (let harmonic = 1; harmonic < 40; harmonic += 1) {
      const frequency = harmonic * 135;
      const gain =
        0.12 / harmonic +
        [650, 1100, 2500].reduce(
          (sum, center) =>
            sum + Math.exp(-0.5 * ((frequency - center) / 130) ** 2),
          0,
        );
      value += gain * Math.sin(harmonic * phase);
    }
    voice[index] = value;
    maximum = Math.max(maximum, Math.abs(value));
  }
  for (let index = 0; index < count; index += 1) {
    const time = index / rate;
    const envelope = Math.min(1, time / 0.06, (0.7 - time) / 0.08);
    const value =
      ((voice[index] ?? 0) / maximum) *
      envelope *
      (0.7 + 0.15 * Math.sin(2 * Math.PI * 5 * time)) *
      0.6;
    bytes.writeInt16LE(Math.round(value * 32_767), 44 + (start + index) * 2);
  }
  return bytes;
}
