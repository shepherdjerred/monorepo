import * as Sentry from "@sentry/bun";
import type { DiscordAccountId } from "@scout-for-lol/data";
import { isQuotaExhaustedError } from "@shepherdjerred/voice-assistant";
import type { VOICE_TRANSCRIPTION_MODEL } from "@shepherdjerred/voice-assistant/openai-audio.ts";
import {
  VOICE_SPEECH_MODEL,
  VOICE_SPEECH_SAMPLE_RATE,
  synthesizeVoiceAnswer,
} from "@shepherdjerred/voice-assistant/openai-audio.ts";
import { exploreSpendPolicy } from "#src/config/dynamic.ts";
import {
  ExploreBudgetError,
  releaseExploreAudio,
  reserveExploreAudio,
  settleExploreAudio,
  type ExploreAudioReservation,
} from "#src/explore/spending/ledger.ts";
import { createLogger } from "#src/logger.ts";
import { voiceAudioRequestSignal } from "#src/voice-assistant/constants.ts";

/**
 * The coach's audio spend and speech, shared by spoken turns
 * (`coach-voice-turn.ts`) and proactive answers spoken aloud
 * (`coach-trigger-speech-route.ts`).
 *
 * Every provider call is held against the owner's Explore allowance before
 * it is made, settled at the audio's real length when it completes, and
 * released when it does not.
 */

const logger = createLogger("coach-speech");

/** `synthesizeVoiceAnswer`'s PCM: 16-bit mono. */
export const SPEECH_BYTES_PER_MS = (VOICE_SPEECH_SAMPLE_RATE * 2) / 1000;

/**
 * The longest a spoken answer can take to say, per character: a deliberately
 * slow 10 characters a second, so the hold taken before synthesis, when the
 * audio's length is unknown, covers what the provider can bill.
 */
export const SPEECH_MS_PER_CHARACTER = 100;

/**
 * Hold the allowance for `audioMs` of audio before a provider is called.
 * Null when the owner's or Explore's monthly allowance cannot cover it; any
 * other ledger failure is a broken contract and propagates.
 */
export async function holdAudio(
  ownerId: DiscordAccountId,
  model: typeof VOICE_TRANSCRIPTION_MODEL | typeof VOICE_SPEECH_MODEL,
  audioMs: number,
): Promise<ExploreAudioReservation | null> {
  try {
    return await reserveExploreAudio({
      ownerId,
      runId: globalThis.crypto.randomUUID(),
      model,
      audioMs,
      policy: exploreSpendPolicy(),
    });
  } catch (error) {
    if (error instanceof ExploreBudgetError) return null;
    throw error;
  }
}

/** Settle a hold at the audio's real length; a ledger failure is reported, never the turn's end. */
export async function settleAudio(
  reservation: ExploreAudioReservation,
  runId: string,
  audioMs: number,
): Promise<void> {
  try {
    await settleExploreAudio(reservation, { audioMs, runId });
  } catch (error) {
    logger.error("Coach audio spend was not recorded", {
      runId,
      model: reservation.model,
      error: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, { tags: { source: "coach-voice-spend" } });
  }
}

/** Give back a hold whose provider call did not complete. */
export async function releaseAudio(
  reservation: ExploreAudioReservation,
): Promise<void> {
  try {
    await releaseExploreAudio(reservation);
  } catch (error) {
    logger.error("Coach audio hold was not released", {
      model: reservation.model,
      error: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, { tags: { source: "coach-voice-spend" } });
  }
}

export type SpeechResult =
  | { readonly ok: true; readonly pcm: Uint8Array }
  | {
      readonly ok: false;
      /**
       * `budget`: the allowance or the provider's budget is spent.
       * `failed`: the provider could not speak it. `aborted`: the reader left.
       */
      readonly reason: "budget" | "failed" | "aborted";
    };

/**
 * Speak `text` for the answer of `runId`: hold the allowance for the longest
 * it can take, synthesize, then settle the hold at the speech's real length.
 */
export async function speakHeld(input: {
  readonly ownerId: DiscordAccountId;
  readonly apiKey: string;
  readonly runId: string;
  readonly text: string;
  readonly signal: AbortSignal;
}): Promise<SpeechResult> {
  const hold = await holdAudio(
    input.ownerId,
    VOICE_SPEECH_MODEL,
    input.text.length * SPEECH_MS_PER_CHARACTER,
  );
  if (hold === null) return { ok: false, reason: "budget" };
  let pcm: Uint8Array;
  try {
    pcm = await synthesizeVoiceAnswer({
      apiKey: input.apiKey,
      text: input.text,
      signal: voiceAudioRequestSignal(input.signal),
    });
  } catch (error) {
    await releaseAudio(hold);
    if (input.signal.aborted) return { ok: false, reason: "aborted" };
    const budget = isQuotaExhaustedError(error);
    logger.warn("Coach speech failed", {
      runId: input.runId,
      budget,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: budget ? "budget" : "failed" };
  }
  await settleAudio(hold, input.runId, pcm.byteLength / SPEECH_BYTES_PER_MS);
  return { ok: true, pcm };
}

/** Split PCM into ordered chunks of at most `maxChunkBytes`, base64-encoded. */
export function pcmChunks(pcm: Uint8Array, maxChunkBytes: number): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < pcm.byteLength; offset += maxChunkBytes) {
    chunks.push(
      Buffer.from(pcm.subarray(offset, offset + maxChunkBytes)).toString(
        "base64",
      ),
    );
  }
  return chunks;
}
