import {
  createAudioTransport as coreCreateAudioTransport,
  type AudioTransport,
} from "@shepherdjerred/discord-plays-core/stream/audio-transport.ts";
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "#src/emulator/constants.ts";

// The emulator emits the m4a mixer's un-quantised Float32 PCM (LRLR interleaved)
// at the engine's native sample rate. ffmpeg reads it raw over a loopback TCP
// socket, so the format must be declared explicitly. We use f32le here (vs s16le
// for MK64) so the Opus encoder receives the un-quantised mixer output (avoids
// the ~40 dB s8 quantisation hiss). The transport plumbing lives in
// discord-plays-core; only these format constants differ per game.
const AUDIO_OPTIONS = {
  format: "f32le",
  sampleRate: AUDIO_SAMPLE_RATE,
  channels: AUDIO_CHANNELS,
} as const;

/** Write Float32 LRLR PCM to the returned transport's `sink`; ffmpeg muxes it into the broadcast. */
export function createAudioTransport(): Promise<AudioTransport> {
  return coreCreateAudioTransport(AUDIO_OPTIONS);
}
