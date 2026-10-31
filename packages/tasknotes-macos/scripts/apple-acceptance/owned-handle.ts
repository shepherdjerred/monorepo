import assert from "node:assert/strict";
import type { FileHandle } from "node:fs/promises";

/** Reads only the measured extent; callers retain their own ownership and freshness checks. */
export async function readExactHandle(
  handle: FileHandle,
  size: number,
  maximumBytes: number,
): Promise<Uint8Array> {
  assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= maximumBytes);
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    assert.ok(result.bytesRead > 0, "Measured file extent was truncated");
    offset += result.bytesRead;
  }
  return bytes;
}
