import { SportsPlaybackError } from "@shepherdjerred/streambot/sports/failures.ts";

/** Bound HTTP responses before buffering manifests or individual media fragments. */
export async function readSportsResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new SportsPlaybackError("unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const chunk: unknown = result.value;
      if (!(chunk instanceof Uint8Array))
        throw new SportsPlaybackError("unavailable");
      size += chunk.length;
      if (size > maximumBytes)
        throw new SportsPlaybackError("unsupported-format");
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
