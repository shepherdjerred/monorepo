import { Readable } from "node:stream";

/** A PCM source with a fixed latency window, including Readable's own buffer. */
export class PcmSink extends Readable {
  private readonly queued: Buffer[] = [];
  private queuedBytes = 0;
  private requested = false;
  private ended = false;
  private dropped = 0;

  constructor(
    private readonly capacity: number,
    private readonly quantum: number,
  ) {
    if (capacity < quantum || quantum < 1)
      throw new RangeError("invalid PCM buffer window");
    super({ highWaterMark: quantum });
  }

  get bufferedBytes(): number {
    return this.readableLength + this.queuedBytes;
  }
  get writableLength(): number {
    return this.bufferedBytes;
  }
  get droppedBytes(): number {
    return this.dropped;
  }

  /** False means older PCM was evicted; this Readable has no Writable drain event. */
  write(samples: Buffer): boolean {
    if (this.ended || this.destroyed) throw new Error("PCM sink is closed");
    let accepted = true;
    for (let offset = 0; offset < samples.length; offset += this.quantum) {
      const bytes = Math.min(this.quantum, samples.length - offset);
      while (this.bufferedBytes + bytes > this.capacity) {
        const oldest = this.queued.shift();
        if (oldest === undefined)
          throw new Error("PCM buffer invariant violated");
        this.queuedBytes -= oldest.length;
        this.dropped += oldest.length;
        accepted = false;
      }
      // Own only this bounded block, even if the producer supplied a large buffer.
      const chunk = Buffer.from(samples.subarray(offset, offset + bytes));
      this.queued.push(chunk);
      this.queuedBytes += bytes;
      this.flush();
    }
    return accepted;
  }

  end(): void {
    this.ended = true;
    this.flush();
  }
  close(): void {
    this.queued.length = 0;
    this.queuedBytes = 0;
    this.destroy();
  }
  override _read(): void {
    this.requested = true;
    this.flush();
  }

  private flush(): void {
    if (!this.requested) return;
    const chunk = this.queued.shift();
    if (chunk !== undefined) {
      this.queuedBytes -= chunk.length;
      this.requested = false;
      this.push(chunk);
    } else if (this.ended) {
      this.requested = false;
      this.push(null);
    }
  }
}
