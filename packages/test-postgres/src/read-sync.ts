import { readFileSync } from "node:fs";

/**
 * Cross-platform synchronous file reads for callers that must stay synchronous
 * (migration hashing and stopped-cluster PG_VERSION checks). `Bun.mmap` throws
 * `mmapFile is not supported on Windows`, and `Bun.file().bytes()` is async.
 */
export function readFileBytesSync(filePath: string): Uint8Array {
  return readFileSync(filePath);
}

export function readFileTextSync(filePath: string): string {
  return readFileSync(filePath, "utf8");
}
