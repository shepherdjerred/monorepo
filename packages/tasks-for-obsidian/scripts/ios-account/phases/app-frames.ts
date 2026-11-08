import { PrivatePhaseFailure, type InputPhase } from "./failure";

/** Bounded private byte pump; decoded frame contents never enter diagnostics. */
export class AppInputFrames {
  private bytes = Buffer.alloc(0);
  private count = 0;
  constructor(
    private readonly reader: {
      read: () => Promise<{ done: boolean; value?: Uint8Array | undefined }>;
    },
    private readonly deadline: () => number,
    private readonly phase: () => InputPhase,
    private readonly rejection: () => Promise<void>,
  ) {}
  clear() {
    this.bytes.fill(0);
    this.bytes = Buffer.alloc(0);
  }
  async next(): Promise<unknown> {
    for (;;) {
      const newline = this.bytes.indexOf(10);
      if (newline !== -1) {
        if (newline <= 0 || newline > 8192 || ++this.count > 11)
          throw new PrivatePhaseFailure("protocol", this.phase());
        const frame = this.bytes.subarray(0, newline);
        this.bytes = this.bytes.subarray(newline + 1);
        try {
          return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(frame),
          );
        } catch {
          throw new PrivatePhaseFailure("protocol", this.phase());
        }
      }
      if (this.bytes.length > 8192)
        throw new PrivatePhaseFailure("protocol", this.phase());
      await this.readChunk();
    }
  }
  private async readChunk() {
    const remaining = this.deadline() - performance.now();
    if (remaining <= 0) throw new PrivatePhaseFailure("deadline", this.phase());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const next = await Promise.race([
      this.reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new PrivatePhaseFailure("deadline", this.phase()));
        }, remaining);
      }),
    ]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
    if (next.done) {
      await this.rejection();
      throw new PrivatePhaseFailure("socket", this.phase());
    }
    if (next.value === undefined)
      throw new PrivatePhaseFailure("protocol", this.phase());
    this.bytes = Buffer.concat([this.bytes, next.value]);
  }
}
