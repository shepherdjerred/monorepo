import {
  createAudioTransport as coreCreateAudioTransport,
  type AudioTransport,
} from "@shepherdjerred/discord-plays-core/stream/audio-transport.ts";
import { AUDIO_CHANNELS } from "#src/emulator/constants.ts";

// Both engines emit signed 16-bit LE stereo PCM, at the engine's own rate
// (FrameFormat.audioSampleRate). ffmpeg reads it raw over a loopback socket, so
// the format must be declared explicitly; it resamples for Opus itself. The
// transport plumbing lives in discord-plays-core; only the format differs per game.

/** Write s16le stereo PCM at `sampleRate` to the returned transport's `sink`. */
export function createAudioTransport(
  sampleRate: number,
): Promise<AudioTransport> {
  return coreCreateAudioTransport({
    format: "s16le",
    sampleRate,
    channels: AUDIO_CHANNELS,
  });
}
