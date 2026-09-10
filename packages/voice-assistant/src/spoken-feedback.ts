import path from "node:path";
import { readPcm16MonoWave } from "./audio/wave-io.ts";

const FEEDBACK_SAMPLE_RATE = 24_000;

/**
 * Pre-rendered local feedback lines, spoken without any Realtime response. A rejected transcript
 * and a rate-limited wake stay response.create-free by design — these clips are the only way the
 * speaker hears anything on those paths, and their bytes never leave the process except as the
 * assistant's reply audio. Consumers own the clip files and their generation tooling.
 */
export type SpokenFeedbackClips = {
  /** "Sorry, I didn't catch that — say <wake phrase> and try again." */
  readonly retry: Uint8Array;
  /** "What would you like me to do?" */
  readonly prompt: Uint8Array;
};

async function loadClip(filename: string): Promise<Uint8Array> {
  const wave = await readPcm16MonoWave(filename);
  if (wave.sampleRate !== FEEDBACK_SAMPLE_RATE) {
    throw new Error(
      `Feedback clip must be ${String(FEEDBACK_SAMPLE_RATE)} Hz mono PCM16: ${filename}`,
    );
  }
  // Back to the raw little-endian PCM16 bytes the assistant sink consumes. The int→float→int
  // round-trip is exact: every 16-bit sample divided by 32768 is representable in float32.
  const bytes = new Uint8Array(wave.samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (const [index, sample] of wave.samples.entries()) {
    const clamped = Math.max(
      -32_768,
      Math.min(32_767, Math.round(sample * 32_768)),
    );
    view.setInt16(index * 2, clamped, true);
  }
  return bytes;
}

/** Fatal when missing or malformed, like every other pinned voice asset. */
export async function loadSpokenFeedbackClips(
  assetsDir: string,
  files: { readonly retry: string; readonly prompt: string },
): Promise<SpokenFeedbackClips> {
  const [retry, prompt] = await Promise.all([
    loadClip(path.join(assetsDir, files.retry)),
    loadClip(path.join(assetsDir, files.prompt)),
  ]);
  return { retry, prompt };
}
