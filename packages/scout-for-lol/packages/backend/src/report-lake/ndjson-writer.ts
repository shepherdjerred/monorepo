import { z } from "zod";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-lake-ndjson");

const ErrorCodeSchema = z.object({ code: z.string() });

function writeErrorCode(error: unknown): string {
  const parsed = ErrorCodeSchema.safeParse(error);
  return parsed.success ? parsed.data.code : "unknown";
}

/**
 * Buffered newline-delimited-JSON file writer used by the report-lake rebuild
 * to stream flattened rows to a temp file before the DuckDB COPY step.
 *
 * Write failures fail the rebuild fast with a single error. The previous
 * fire-and-forget flush turned one full disk into thousands of
 * unhandled-rejection Sentry events while the rebuild kept "writing" into
 * the void and published truncated output.
 */
/** The `Bun.FileSink` surface the writer uses; injectable for tests. */
export type NdjsonSink = Pick<Bun.FileSink, "write" | "end">;

export class NdjsonFileWriter {
  private readonly writer: NdjsonSink;
  private buffered: string[] = [];
  private asyncWriteError: unknown = undefined;
  private hasAsyncWriteError = false;
  rows = 0;

  constructor(
    readonly filePath: string,
    writer?: NdjsonSink,
  ) {
    try {
      this.writer = writer ?? Bun.file(filePath).writer();
    } catch (error) {
      throw this.describeWriteError(error);
    }
  }

  write(row: object): void {
    this.buffered.push(JSON.stringify(row));
    this.rows += 1;
    if (this.buffered.length >= 2000) {
      this.flush();
    }
  }

  private throwIfWriteFailed(): void {
    if (this.hasAsyncWriteError) {
      throw this.describeWriteError(this.asyncWriteError);
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

  private flush(): void {
    this.throwIfWriteFailed();
    if (this.buffered.length === 0) {
      return;
    }
    const data = `${this.buffered.join("\n")}\n`;
    this.buffered = [];
    let result: number | Promise<number>;
    try {
      result = this.writer.write(data);
    } catch (error) {
      throw this.describeWriteError(error);
    }
    if (result instanceof Promise) {
      // Backpressure path: without a rejection handler this surfaces as an
      // unhandled rejection per flush. Capture the first failure and rethrow
      // it on the next flush or close so the rebuild aborts instead.
      const pending = result;
      void (async () => {
        try {
          await pending;
        } catch (error) {
          if (!this.hasAsyncWriteError) {
            this.hasAsyncWriteError = true;
            this.asyncWriteError = error;
          }
        }
      })();
    }
  }

  async close(): Promise<void> {
    this.flush();
    try {
      await this.writer.end();
    } catch (error) {
      throw this.describeWriteError(error);
    }
  }
}
