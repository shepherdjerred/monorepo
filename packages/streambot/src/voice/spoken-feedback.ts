import path from "node:path";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import { PacedAssistantSender } from "@shepherdjerred/streambot/voice/assistant-sink.ts";
import { readPcm16MonoWave } from "@shepherdjerred/streambot/voice/wave-io.ts";

const FEEDBACK_SAMPLE_RATE = 24_000;

/**
 * Pre-rendered local feedback lines, spoken without any Realtime response. A rejected transcript
 * and a rate-limited wake stay response.create-free by design — these clips are the only way the
 * speaker hears anything on those paths, and their bytes never leave the process except as Discord
 * reply audio. Regenerate with scripts/voice-feedback-generate.ts.
 */
export type SpokenFeedbackClips = {
  /** "Sorry, I didn't catch that — say Hey Streambot and try again." */
  readonly retry: Uint8Array;
  /** "What would you like me to play?" */
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
): Promise<SpokenFeedbackClips> {
  const [retry, prompt] = await Promise.all([
    loadClip(path.join(assetsDir, "feedback-retry.wav")),
    loadClip(path.join(assetsDir, "feedback-prompt.wav")),
  ]);
  return { retry, prompt };
}

/** Speak one local clip over normal voice with the standard paced sender and duck handling. */
export async function speakClip(
  streamer: StreamerLike,
  clip: Uint8Array,
): Promise<void> {
  const sender = new PacedAssistantSender(streamer);
  sender.enqueue(clip);
  await sender.finish();
}
