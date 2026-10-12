import { z } from "zod";
import { setImmediate } from "node:timers/promises";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-lake-ndjson");

const ErrorCodeSchema = z.object({ code: z.string() });
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_BUFFERED_ROWS = 2000;

function writeErrorCode(error: unknown): string {
  const parsed = ErrorCodeSchema.safeParse(error);
  return parsed.success ? parsed.data.code : "unknown";
}

/**
 * Buffered newline-delimited-JSON file writer used by the report-lake rebuild
 * to stream flattened rows to a temp file before the DuckDB COPY step.
 *
 * Buffers are byte-bounded because raw document rows can contain entire Riot
 * timelines. Producers await writes so disk backpressure bounds the sink's
 * buffers too, and a write failure aborts before publishing truncated output.
 */
/** The `Bun.FileSink` surface the writer uses; injectable for tests. */
export type NdjsonSink = Pick<Bun.FileSink, "write" | "flush" | "end">;

export class NdjsonFileWriter {
  private readonly writer: NdjsonSink;
  private buffered: string[] = [];
  private bufferedBytes = 0;
  private closed = false;
  rows = 0;

  constructor(
    readonly filePath: string,
    writer?: NdjsonSink,
    private readonly abortSignal?: AbortSignal,
  ) {
    try {
      this.writer =
        writer ??
        Bun.file(filePath).writer({ highWaterMark: MAX_BUFFERED_BYTES });
    } catch (error) {
      throw this.describeWriteError(error);
    }
  }

  async write(row: object): Promise<void> {
    this.abortSignal?.throwIfAborted();
    const data = JSON.stringify(row);
    const bytes = Buffer.byteLength(data, "utf8") + 1;
    if (this.bufferedBytes + bytes > MAX_BUFFERED_BYTES) {
      await this.flush();
    }
    this.buffered.push(data);
    this.bufferedBytes += bytes;
    this.rows += 1;
    if (
      this.bufferedBytes >= MAX_BUFFERED_BYTES ||
      this.buffered.length >= MAX_BUFFERED_ROWS
    ) {
      await this.flush();
    }
  }

  private describeWriteError(error: unknown): Error {
    logger.error(
      `Report-lake NDJSON write failed for ${this.filePath}:`,
      error,
    );
    return new Error(
      `Report-lake NDJSON write failed (${writeErrorCode(error)}): lake volume full, quota exceeded, or unwritable`,
      { cause: error },
    );
  }

  private async flush(): Promise<void> {
    if (this.buffered.length === 0) {
      return;
    }
    const data = `${this.buffered.join("\n")}\n`;
    this.buffered = [];
    this.bufferedBytes = 0;
    try {
      await this.writer.write(data);
      await this.writer.flush();
    } catch (error) {
      throw this.describeWriteError(error);
    }
    // Awaiting synchronous FileSink writes only queues microtasks. Yield after
    // each bounded buffer so Activity heartbeat/cancellation timers can run.
    await setImmediate();
    this.abortSignal?.throwIfAborted();
  }

  async close(): Promise<void> {
    await this.flush();
    try {
      await this.writer.end();
      this.closed = true;
    } catch (error) {
      throw this.describeWriteError(error);
    }
  }

  /** Close an abandoned build without serializing its remaining buffered rows. */
  async abort(): Promise<void> {
    if (this.closed) return;
    this.buffered = [];
    this.bufferedBytes = 0;
    try {
      await this.writer.end();
      this.closed = true;
    } catch (error) {
      throw this.describeWriteError(error);
    }
  }
}
