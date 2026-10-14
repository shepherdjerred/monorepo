import type { FileHandle } from "node:fs/promises";

/** Keep one in-flight state and the newest pending state for a controller FIFO. */
export class PipeWriter {
  private pending: string | undefined;
  private writing: Promise<void> | undefined;
  private failure: Error | undefined;

  constructor(
    private readonly file: FileHandle,
    private readonly failed: (error: Error) => void,
  ) {}

  write(message: string): void {
    if (this.failure !== undefined) throw this.failure;
    this.pending = message;
    this.writing ??= this.drain();
  }

  async close(): Promise<void> {
    await this.writing;
    await this.file.close();
    if (this.failure !== undefined) throw this.failure;
  }

  private async drain(): Promise<void> {
    await Promise.resolve();
    try {
      while (this.pending !== undefined) {
        const message = this.pending;
        this.pending = undefined;
        const bytes = Buffer.from(message);
        const result = await this.file.write(bytes);
        if (result.bytesWritten !== bytes.length)
          throw new Error("Controller FIFO did not accept a complete state");
      }
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      try {
        this.failed(this.failure);
      } catch (reportError) {
        this.failure = new AggregateError(
          [this.failure, reportError],
          "Controller pipe and failure reporting failed",
        );
      }
    } finally {
      this.writing = undefined;
    }
  }
}
