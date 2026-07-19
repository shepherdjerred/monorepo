/**
 * Buffered newline-delimited-JSON file writer used by the report-lake rebuild
 * to stream flattened rows to a temp file before the DuckDB COPY step.
 */
export class NdjsonFileWriter {
  private readonly writer: Bun.FileSink;
  private buffered: string[] = [];
  rows = 0;

  constructor(readonly filePath: string) {
    this.writer = Bun.file(filePath).writer();
  }

  write(row: object): void {
    this.buffered.push(JSON.stringify(row));
    this.rows += 1;
    if (this.buffered.length >= 2000) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.buffered.length > 0) {
      // FileSink.write buffers internally and only returns a promise under
      // backpressure; end() in close() flushes everything either way.
      void this.writer.write(this.buffered.join("\n") + "\n");
      this.buffered = [];
    }
  }

  async close(): Promise<void> {
    this.flush();
    await this.writer.end();
  }
}
