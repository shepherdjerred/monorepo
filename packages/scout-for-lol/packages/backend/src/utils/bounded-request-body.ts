/**
 * Read a request body without letting an unauthenticated caller decide how
 * much memory this process allocates.
 *
 * A `Content-Length` check is worth keeping in front of this because it
 * rejects the common case for free, but it cannot be the whole guard: the
 * header is absent on a chunked request and the client controls it either
 * way. Reading through the stream and abandoning it at the limit is what
 * actually bounds the read — `await request.text()` has already buffered
 * everything by the time a size check can look at it.
 */

export type BoundedBody = { ok: true; text: string } | { ok: false };

export async function readBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<BoundedBody> {
  const body: ReadableStream<Uint8Array> | null = request.body;
  if (body === null) {
    return { ok: true, text: "" };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  // Decoded once at the end so a multi-byte character split across two chunks
  // still decodes correctly.
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}
