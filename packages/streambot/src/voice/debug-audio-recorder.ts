import path from "node:path";
import { rename, rm } from "node:fs/promises";

const WAV_HEADER_BYTES = 44;
const SAMPLE_RATE = 24_000;
const CHANNEL_COUNT = 1;
const BITS_PER_SAMPLE = 16;

export type DebugAudioRecording = {
  readonly path: string;
  readonly durationSeconds: number;
  readonly peak: number;
  readonly rms: number;
};

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) throw new Error("Invalid WAV header text");
    view.setUint8(offset + index, codePoint);
  }
}

function createPcm16Wav(pcm: Uint8Array): Uint8Array {
  if (pcm.byteLength % 2 !== 0) {
    throw new Error("Debug microphone PCM must contain complete int16 samples");
  }
  const wav = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const byteRate = SAMPLE_RATE * CHANNEL_COUNT * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNEL_COUNT * (BITS_PER_SAMPLE / 8);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNEL_COUNT, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

/** Opt-in diagnostic recorder for the exact microphone PCM presented to the Opus encoder. */
export class DebugAudioRecorder {
  private readonly chunks: Uint8Array[] = [];
  private byteLength = 0;
  private sampleCount = 0;
  private sumSquares = 0;
  private peakValue = 0;
  private finished = false;

  accept(pcm24k: Uint8Array): void {
    if (this.finished)
      throw new Error("Debug audio recorder is already closed");
    if (pcm24k.byteLength % 2 !== 0) {
      throw new Error(
        "Debug microphone PCM must contain complete int16 samples",
      );
    }
    const copy = Uint8Array.from(pcm24k);
    this.chunks.push(copy);
    this.byteLength += copy.byteLength;
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    for (let offset = 0; offset < copy.byteLength; offset += 2) {
      const normalized = view.getInt16(offset, true) / 32_768;
      const absolute = Math.abs(normalized);
      if (absolute > this.peakValue) this.peakValue = absolute;
      this.sumSquares += normalized * normalized;
      this.sampleCount += 1;
    }
  }

  async save(outputPath: string): Promise<DebugAudioRecording> {
    if (this.finished)
      throw new Error("Debug audio recorder is already closed");
    this.finished = true;
    const pcm = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      pcm.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const wav = createPcm16Wav(pcm);
    const temporaryPath = `${outputPath}.tmp-${crypto.randomUUID()}`;
    try {
      await Bun.write(temporaryPath, wav, { createPath: true });
      await rename(temporaryPath, outputPath);
      return {
        path: path.resolve(outputPath),
        durationSeconds: this.sampleCount / SAMPLE_RATE,
        peak: this.peakValue,
        rms:
          this.sampleCount === 0
            ? 0
            : Math.sqrt(this.sumSquares / this.sampleCount),
      };
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    } finally {
      pcm.fill(0);
      wav.fill(0);
      this.clearChunks();
    }
  }

  close(): void {
    this.finished = true;
    this.clearChunks();
  }

  private clearChunks(): void {
    for (const chunk of this.chunks) chunk.fill(0);
    this.chunks.length = 0;
    this.byteLength = 0;
  }
}
