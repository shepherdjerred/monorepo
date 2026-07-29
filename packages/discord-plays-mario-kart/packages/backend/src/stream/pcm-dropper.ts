/**
 * Drops a scheduled amount from the front of future PCM chunks.
 *
 * Raw video does not carry source timestamps: ffmpeg assigns consecutive
 * 30 fps PTS values to whichever frames reach its pipe. Dropping video without
 * also dropping the matching PCM therefore compresses only the video content
 * timeline and makes sound happen progressively later. This helper keeps the
 * drop amount sample-frame aligned and allows a debt to span arbitrary chunk
 * boundaries.
 */
export class PcmDropper {
  private bytesRemaining = 0;

  constructor(private readonly blockAlign: number) {
    if (!Number.isInteger(blockAlign) || blockAlign <= 0) {
      throw new RangeError("PCM block alignment must be a positive integer");
    }
  }

  dropNext(bytes: number): void {
    this.requireAligned(bytes, "scheduled PCM drop");
    this.bytesRemaining += bytes;
  }

  process(pcm: Buffer): Buffer {
    this.requireAligned(pcm.length, "PCM chunk");
    if (this.bytesRemaining === 0) return pcm;

    const dropped = Math.min(this.bytesRemaining, pcm.length);
    this.bytesRemaining -= dropped;
    return pcm.subarray(dropped);
  }

  reset(): void {
    this.bytesRemaining = 0;
  }

  private requireAligned(bytes: number, label: string): void {
    if (
      !Number.isInteger(bytes) ||
      bytes < 0 ||
      bytes % this.blockAlign !== 0
    ) {
      throw new RangeError(
        `${label} must be a non-negative multiple of ${String(this.blockAlign)} bytes`,
      );
    }
  }
}
