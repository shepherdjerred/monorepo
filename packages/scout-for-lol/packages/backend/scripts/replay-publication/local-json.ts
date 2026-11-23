import { lstat, open } from "node:fs/promises";

export async function readReplayJsonInput(
  filename: string,
  kind: "publication" | "admission" | "comparison report",
  maxBytes = 32 * 1024 * 1024,
): Promise<{ bytes: Uint8Array; text: string; value: unknown }> {
  const input = await lstat(filename);
  if (!input.isFile())
    throw new Error(`Replay ${kind} input must be a regular JSON file`);
  const handle = await open(filename, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size === 0 || stats.size > maxBytes)
      throw new Error(
        `Replay ${kind} input is empty or exceeds its size limit`,
      );
    const { size } = stats;
    const bytes = new Uint8Array(size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== size)
      throw new Error(`Replay ${kind} input changed while reading`);
    try {
      const originalBytes = bytes.subarray(0, size);
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(originalBytes);
      const value: unknown = JSON.parse(text);
      return { bytes: originalBytes, text, value };
    } catch {
      throw new Error(`Replay ${kind} input is not valid UTF-8 JSON`);
    }
  } finally {
    await handle.close();
  }
}
