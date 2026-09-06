/**
 * One received Opus packet from a single speaker. Transport-agnostic: any Discord (or other)
 * receive path whose packets carry a stable per-speaker id can feed the audio lifecycle.
 * Consumers may pass richer structures (extra fields are ignored); the lifecycle zero-fills
 * `opus` after decoding as part of the erase-everything invariant.
 */
export type VoiceAudioInput = {
  readonly userId: string;
  readonly opus: Uint8Array;
};
