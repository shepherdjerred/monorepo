import {
  SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES,
  SCOUT_DESKTOP_VOICE_MIN_WAV_BYTES,
  SCOUT_DESKTOP_VOICE_TURN,
  SCOUT_DESKTOP_VOICE_WAV_HEADER_BYTES,
  type ScoutDesktopVoiceTrigger,
  type ScoutDesktopVoiceWakeVerification,
} from "@scout-for-lol/data";
import { verifyWakeTranscript } from "@shepherdjerred/voice-assistant";
import { VOICE_WAKE_PREFIXES } from "#src/voice-assistant/constants.ts";

/**
 * The two pure halves of a spoken coach turn (`coach/voice/turns`): reading
 * the one utterance the desktop uploaded, and proving from the server's own
 * transcript that the player asked.
 */

const { sampleRateHz, channels, bitsPerSample } =
  SCOUT_DESKTOP_VOICE_TURN.audio;
const BYTES_PER_SAMPLE = bitsPerSample / 8;

export type VoiceUtterance = {
  /** Mono samples in [-1, 1), as `transcribeVoiceQuestion` takes them. */
  readonly pcm16k: Float32Array;
  readonly durationMs: number;
};

export type VoiceUtteranceResult =
  | { readonly ok: true; readonly utterance: VoiceUtterance }
  | { readonly ok: false; readonly message: string };

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCodePoint(...bytes.subarray(offset, offset + length));
}

function refuse(message: string): VoiceUtteranceResult {
  return { ok: false, message };
}

/**
 * Read one utterance: a canonical 44-byte PCM WAV header (RIFF, `fmt `, then
 * `data`), 16 kHz mono 16-bit, between the contract's shortest and longest
 * utterance. Anything else is refused whole; the desktop writes exactly this
 * shape, so another one is a broken client, not audio to make the best of.
 */
export function parseVoiceUtterance(bytes: Uint8Array): VoiceUtteranceResult {
  if (bytes.byteLength > SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES) {
    return refuse(
      `The recording is longer than ${(SCOUT_DESKTOP_VOICE_TURN.audio.maxDurationMs / 1000).toString()} seconds.`,
    );
  }
  if (bytes.byteLength < SCOUT_DESKTOP_VOICE_MIN_WAV_BYTES) {
    return refuse("The recording is too short to hold a question.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataBytes = bytes.byteLength - SCOUT_DESKTOP_VOICE_WAV_HEADER_BYTES;
  const canonical =
    ascii(bytes, 0, 4) === "RIFF" &&
    view.getUint32(4, true) === bytes.byteLength - 8 &&
    ascii(bytes, 8, 4) === "WAVE" &&
    ascii(bytes, 12, 4) === "fmt " &&
    view.getUint32(16, true) === 16 &&
    ascii(bytes, 36, 4) === "data" &&
    view.getUint32(40, true) === dataBytes;
  if (!canonical) {
    return refuse("The recording is not a plain PCM WAV file.");
  }
  const format = {
    encoding: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
  };
  const blockAlign = channels * BYTES_PER_SAMPLE;
  if (
    format.encoding !== 1 ||
    format.channels !== channels ||
    format.sampleRate !== sampleRateHz ||
    format.bitsPerSample !== bitsPerSample ||
    format.blockAlign !== blockAlign ||
    format.byteRate !== sampleRateHz * blockAlign ||
    dataBytes % blockAlign !== 0
  ) {
    return refuse(
      `The recording must be ${(sampleRateHz / 1000).toString()} kHz mono 16-bit PCM.`,
    );
  }
  const samples = new Float32Array(dataBytes / blockAlign);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] =
      view.getInt16(
        SCOUT_DESKTOP_VOICE_WAV_HEADER_BYTES + index * blockAlign,
        true,
      ) / 32_768;
  }
  return {
    ok: true,
    utterance: {
      pcm16k: samples,
      durationMs: Math.round((samples.length / sampleRateHz) * 1000),
    },
  };
}

export type VoiceInitiationProof =
  | {
      readonly ok: true;
      /** The question to answer, the wake phrase stripped. */
      readonly question: string;
      readonly wake: ScoutDesktopVoiceWakeVerification;
    }
  | {
      readonly ok: false;
      readonly code: "wake_not_verified" | "empty_question";
    };

/**
 * Prove from the server's own transcript that the player asked.
 *
 * A `wake_word` turn passes only when the transcript opens with the wake
 * phrase, judged by the strict gate Discord voice uses
 * (`verifyWakeTranscript` with `VOICE_WAKE_PREFIXES`), and its question is
 * what follows it. The client's local wake detector is a trigger, never the
 * proof. A `push_to_talk` turn needs no phrase: holding the key is the act,
 * and the whole transcript is the question.
 */
export function proveVoiceInitiation(
  transcript: string,
  trigger: ScoutDesktopVoiceTrigger,
): VoiceInitiationProof {
  if (trigger === "push_to_talk") {
    const question = transcript.trim();
    return question.length === 0
      ? { ok: false, code: "empty_question" }
      : { ok: true, question, wake: "not_required" };
  }
  const verified = verifyWakeTranscript(transcript, VOICE_WAKE_PREFIXES);
  if (verified === null) return { ok: false, code: "wake_not_verified" };
  return verified.command.length === 0
    ? { ok: false, code: "empty_question" }
    : { ok: true, question: verified.command, wake: "verified" };
}
