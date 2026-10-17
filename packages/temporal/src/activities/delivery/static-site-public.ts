import { createHash } from "node:crypto";
import { staticArchiveDigest } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";

/** Check the actual public entrypoint, including stale CDN responses with HTTP 200. */
export async function verifyPublicStaticEntrypoint(input: {
  response: Response;
  expectedFile: string;
  expectedStatus: number;
  signal: AbortSignal;
}): Promise<void> {
  const { response, expectedFile, expectedStatus, signal } = input;
  if (response.status !== expectedStatus || response.body === null) {
    await response.body?.cancel();
    throw new Error("Static public entrypoint acceptance failed");
  }
  const expected = Bun.file(expectedFile);
  const digest = createHash("sha256");
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array))
        throw new TypeError(
          "Static public entrypoint returned a non-byte stream",
        );
      bytes += value.byteLength;
      if (bytes > expected.size)
        throw new Error(
          "Public static entrypoint differs from selected archive",
        );
      digest.update(value);
    }
    signal.throwIfAborted();
    if (
      bytes !== expected.size ||
      `sha256:${digest.digest("hex")}` !==
        (await staticArchiveDigest(expectedFile))
    )
      throw new Error("Public static entrypoint differs from selected archive");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
