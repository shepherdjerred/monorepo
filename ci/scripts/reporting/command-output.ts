/** Keep bounded error evidence while showing progress as the command runs. */
export const OUTPUT_TAIL_LIMIT = 128 * 1024;

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
    tail = (tail + decoder.decode(chunk, { stream: true })).slice(
      -OUTPUT_TAIL_LIMIT,
    );
  }
  return (tail + decoder.decode()).slice(-OUTPUT_TAIL_LIMIT);
}
