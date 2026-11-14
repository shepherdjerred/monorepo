const MAX_RESPONSE_BYTES = 2_097_152;

/** Bound every browser JSON response before parsing external data. */
export async function readBrowserJsonResponse(
  response: Response,
): Promise<unknown> {
  if (response.body === null) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const chunk: unknown = result.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("PinchTab returned an invalid response body");
      }
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("PinchTab response exceeded its size limit");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
