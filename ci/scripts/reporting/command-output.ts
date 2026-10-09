/** Keep bounded error evidence while showing progress as the command runs. */
export const OUTPUT_TAIL_LIMIT = 128 * 1024;

function boundedUtf8Tail(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= OUTPUT_TAIL_LIMIT) return text;
  let start = bytes.byteLength - OUTPUT_TAIL_LIMIT;
  // The retained suffix must start at a whole UTF-8 code point.
  while (start < bytes.byteLength && ((bytes[start] ?? 0) & 0xc0) === 0x80)
    start++;
  return new TextDecoder().decode(bytes.subarray(start));
}

export async function teeOutputTail(
  stream: ReadableStream<Uint8Array>,
  write: (chunk: Uint8Array) => Promise<unknown>,
): Promise<string> {
  const decoder = new TextDecoder();
  let tail = "";
  for await (const chunk of stream) {
    // Await the destination to respect backpressure; an unbounded write queue
    // would defeat the bounded diagnostic tail during a noisy build.
    await write(chunk);
    tail = boundedUtf8Tail(tail + decoder.decode(chunk, { stream: true }));
  }
  return boundedUtf8Tail(tail + decoder.decode());
}
