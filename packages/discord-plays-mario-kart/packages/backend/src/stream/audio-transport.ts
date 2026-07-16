import {
  createAudioTransport as coreCreateAudioTransport,
  type AudioTransport,
} from "@shepherdjerred/discord-plays-core/stream/audio-transport.ts";
import { AUDIO_SAMPLE_RATE, AUDIO_CHANNELS } from "#src/emulator/constants.ts";

// The emulator emits resampled PCM (signed 16-bit LE, stereo, 44.1 kHz). ffmpeg
// reads it raw over a loopback socket, so the format must be declared explicitly.
// The transport plumbing lives in discord-plays-core; only these format constants
// differ per game.
const AUDIO_OPTIONS = {
  format: "s16le",
  sampleRate: AUDIO_SAMPLE_RATE,
  channels: AUDIO_CHANNELS,
} as const;

/** Write resampled PCM (s16le/44.1 kHz/stereo) to the returned transport's `sink`. */
export function createAudioTransport(): Promise<AudioTransport> {
  return coreCreateAudioTransport(AUDIO_OPTIONS);
}
