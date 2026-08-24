import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  writeSync,
} from "node:fs";

export type SynchronousFileSinkWriter = (
  fileDescriptor: number,
  line: string,
) => void;

export const writeFileSinkSynchronously: SynchronousFileSinkWriter = (
  fileDescriptor,
  line,
) => {
  const bytes = Buffer.from(line);
  const initialSize = fstatSync(fileDescriptor).size;
  let written = 0;
  while (written < bytes.length) {
    const count = writeSync(
      fileDescriptor,
      bytes,
      written,
      bytes.length - written,
      initialSize + written,
    );
    if (count === 0) {
      throw new Error("Run event write made no forward progress");
    }
    written += count;
  }
  fsyncSync(fileDescriptor);
};

export class SynchronousEventFile {
  readonly #fileDescriptor: number;

  constructor(file: string, mode: number) {
    this.#fileDescriptor = openSync(file, "wx", mode);
  }

  write(
    line: string,
    eventKind: string,
    writer: SynchronousFileSinkWriter,
  ): void {
    const previousSize = fstatSync(this.#fileDescriptor).size;
    try {
      writer(this.#fileDescriptor, line);
    } catch (error) {
      try {
        ftruncateSync(this.#fileDescriptor, previousSize);
        fsyncSync(this.#fileDescriptor);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Failed to persist ${eventKind} and restore the event stream`,
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  close(): void {
    closeSync(this.#fileDescriptor);
  }
}
