import { logger } from "../utils/index.js";

type AudioBufferEntry = {
  chunks: Buffer[];
  lastActivity: number;
  totalBytes: number;
};

const userBuffers = new Map<string, AudioBufferEntry>();

const MAX_BUFFER_DURATION_MS = 30000; // 30 seconds max recording
const BYTES_PER_SECOND = 48000 * 2 * 2; // 48kHz, 16-bit, stereo
const MAX_BUFFER_BYTES = (MAX_BUFFER_DURATION_MS / 1000) * BYTES_PER_SECOND;

export function appendAudioChunk(userId: string, chunk: Buffer): void {
  let entry = userBuffers.get(userId);

  if (!entry) {
    entry = {
      chunks: [],
      lastActivity: Date.now(),
      totalBytes: 0,
    };
    userBuffers.set(userId, entry);
  }

  // Check if buffer would exceed max size
  if (entry.totalBytes + chunk.length > MAX_BUFFER_BYTES) {
    // Remove oldest chunks to make room
    while (
      entry.chunks.length > 0 &&
      entry.totalBytes + chunk.length > MAX_BUFFER_BYTES
    ) {
      const removed = entry.chunks.shift();
      if (removed) {
        entry.totalBytes -= removed.length;
      }
    }
  }

  entry.chunks.push(chunk);
  entry.totalBytes += chunk.length;
  entry.lastActivity = Date.now();
}

export function getAudioBuffer(userId: string): Buffer | null {
  const entry = userBuffers.get(userId);
  if (!entry || entry.chunks.length === 0) {
    return null;
  }
  return Buffer.concat(entry.chunks);
}

export function clearAudioBuffer(userId: string): void {
  userBuffers.delete(userId);
}

export function getLastActivityTime(userId: string): number | null {
  const entry = userBuffers.get(userId);
  return entry?.lastActivity ?? null;
}

export function getBufferDurationMs(userId: string): number {
  const entry = userBuffers.get(userId);
  if (!entry) return 0;

  // Approximate duration based on bytes (48kHz, 16-bit, stereo)
  return (entry.totalBytes / BYTES_PER_SECOND) * 1000;
}

export function hasAudioData(userId: string): boolean {
  const entry = userBuffers.get(userId);
  return entry !== undefined && entry.chunks.length > 0;
}

export function cleanupInactiveBuffers(maxInactiveMs: number): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [userId, entry] of userBuffers.entries()) {
    if (now - entry.lastActivity > maxInactiveMs) {
      userBuffers.delete(userId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug("Cleaned up inactive audio buffers", { count: cleaned });
  }

  return cleaned;
}

export function clearAllBuffers(): void {
  userBuffers.clear();
}
