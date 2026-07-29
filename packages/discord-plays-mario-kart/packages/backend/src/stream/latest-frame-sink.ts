import { Readable } from "node:stream";
import type { FrameSink } from "@shepherdjerred/discord-stream-lifecycle/types.ts";

export type LatestFrameSinkOptions<T> = {
  readonly frameBytes: number;
  readonly maxBufferedFrames: number;
  readonly onFrameEvicted: (metadata: T | undefined) => void;
  readonly onFrameDelivered: (metadata: T | undefined) => void;
};

type QueuedFrame<T> = {
  frame: Buffer;
  metadata: T | undefined;
};

/**
 * A frame-granular rawvideo source that keeps the newest bounded window.
 *
 * One frame may sit in Readable's internal buffer while the remaining frames
 * stay in `queued`. When the complete window is full, evicting the oldest
 * queued frame advances video content toward the continuously advancing audio
 * timeline instead of preserving stale video or dropping the newest content.
 */
export class LatestFrameSink<T = never> extends Readable implements FrameSink {
  private readonly frameBytes: number;
  private readonly maxBufferedFrames: number;
  private readonly onFrameEvicted: (metadata: T | undefined) => void;
  private readonly onFrameDelivered: (metadata: T | undefined) => void;
  private readonly queued: QueuedFrame<T>[] = [];
  private readRequested = false;
  private ended = false;

  constructor(options: LatestFrameSinkOptions<T>) {
    if (options.maxBufferedFrames < 2) {
      throw new RangeError("maxBufferedFrames must be at least 2");
    }
    super({ highWaterMark: options.frameBytes });
    this.frameBytes = options.frameBytes;
    this.maxBufferedFrames = options.maxBufferedFrames;
    this.onFrameEvicted = options.onFrameEvicted;
    this.onFrameDelivered = options.onFrameDelivered;
  }

  get bufferedBytes(): number {
    return this.readableLength + this.queued.length * this.frameBytes;
  }

  get writableLength(): number {
    return this.bufferedBytes;
  }

  write(frame: Buffer): boolean {
    return this.writeFrame(frame);
  }

  writeFrame(frame: Buffer, metadata?: T): boolean {
    if (this.ended) {
      throw new Error("cannot write a frame after the sink has ended");
    }
    if (frame.length !== this.frameBytes) {
      throw new RangeError(
        `invalid rawvideo frame size: expected ${String(this.frameBytes)}, received ${String(frame.length)}`,
      );
    }

    let evicted = false;
    if (this.bufferedBytes >= this.maxBufferedFrames * this.frameBytes) {
      const dropped = this.queued.shift();
      this.onFrameEvicted(dropped?.metadata);
      evicted = true;
    }
    this.queued.push({ frame, metadata });
    this.flush();
    return !evicted;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.flush();
  }

  override _read(): void {
    this.readRequested = true;
    this.flush();
  }

  private flush(): void {
    if (!this.readRequested) return;
    const queued = this.queued.shift();
    if (queued !== undefined) {
      this.readRequested = false;
      this.push(queued.frame);
      this.onFrameDelivered(queued.metadata);
      return;
    }
    if (this.ended) {
      this.readRequested = false;
      this.push(null);
    }
  }
}
