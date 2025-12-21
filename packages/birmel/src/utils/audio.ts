// Audio format utilities for voice processing

export type AudioFormat = {
  sampleRate: number;
  channels: number;
  bitDepth: number;
};

export const DISCORD_AUDIO_FORMAT: AudioFormat = {
  sampleRate: 48000,
  channels: 2,
  bitDepth: 16,
};

export const WHISPER_AUDIO_FORMAT: AudioFormat = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
};

export function calculateDurationMs(
  byteLength: number,
  format: AudioFormat,
): number {
  const bytesPerSample = format.bitDepth / 8;
  const samplesPerSecond = format.sampleRate * format.channels;
  const bytesPerSecond = samplesPerSecond * bytesPerSample;
  return (byteLength / bytesPerSecond) * 1000;
}

export function calculateByteLength(
  durationMs: number,
  format: AudioFormat,
): number {
  const bytesPerSample = format.bitDepth / 8;
  const samplesPerSecond = format.sampleRate * format.channels;
  const bytesPerSecond = samplesPerSecond * bytesPerSample;
  return Math.ceil((durationMs / 1000) * bytesPerSecond);
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${String(minutes)}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(remainingSeconds)}s`;
}

export function isValidAudioBuffer(buffer: Buffer): boolean {
  // Basic validation - check if buffer has reasonable size for audio
  return buffer.length > 0 && buffer.length < 100_000_000; // Max 100MB
}

export function createSilenceBuffer(
  durationMs: number,
  format: AudioFormat = DISCORD_AUDIO_FORMAT,
): Buffer {
  const byteLength = calculateByteLength(durationMs, format);
  return Buffer.alloc(byteLength, 0);
}
