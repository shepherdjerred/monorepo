/** Stream continuous stereo PCM at 48 kHz while retaining only one input sample. */
export class AudioResampler {
  private phase = 0;
  private left = 0;
  private right = 0;

  convert(
    samples: ArrayLike<number>,
    sampleRate: number,
    scale = 1,
  ): Uint8Array<ArrayBuffer> {
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 96_000 ||
      samples.length % 2 !== 0
    )
      throw new Error("Invalid stereo audio block");
    const step = sampleRate / 48_000;
    const output = new Int16Array(
      (Math.ceil(samples.length / 2 / step) + 2) * 2,
    );
    let written = 0;
    for (let index = 0; index < samples.length; index += 2) {
      const l = samples[index];
      const r = samples[index + 1];
      if (
        l === undefined ||
        r === undefined ||
        !Number.isFinite(l) ||
        !Number.isFinite(r)
      )
        throw new Error("Invalid PCM sample");
      const left = l * scale;
      const right = r * scale;
      while (this.phase < 48_000) {
        const fraction = this.phase / 48_000;
        output[written++] = quantize(this.left + (left - this.left) * fraction);
        output[written++] = quantize(
          this.right + (right - this.right) * fraction,
        );
        this.phase += sampleRate;
      }
      this.phase -= 48_000;
      this.left = left;
      this.right = right;
    }
    return new Uint8Array(output.buffer, 0, written * 2);
  }
}

function quantize(value: number): number {
  const sample = Math.max(-1, Math.min(1, value));
  return Math.round(sample * (sample < 0 ? 32_768 : 32_767));
}
