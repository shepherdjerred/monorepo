import { z } from "zod";

const BodyChunkSchema = z.instanceof(Uint8Array);

/**
 * Read and discard whatever is left of an upload we are about to refuse.
 *
 * A replay is refused by three database round-trips that all finish before the
 * first body byte is read. Answering there leaves the client mid-PUT, and the
 * reverse proxy in front of this service sees the upstream close on a request
 * it cannot replay — so a deliberate 409 reached the desktop client as an
 * inscrutable `502 Bad Gateway`. Draining costs no bandwidth that was not
 * already being spent: those bytes are on the wire either way. It only decides
 * whether we read them or reset the connection underneath them.
 */
export async function drainRequestBody(
  request: Request,
  limitBytes: number,
): Promise<void> {
  const body = request.body;
  if (body === null || request.bodyUsed) return;
  const reader = body.getReader();
  let drained = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = BodyChunkSchema.safeParse(chunk.value);
      if (!bytes.success) break;
      drained += bytes.data.byteLength;
      // A sender that keeps going past the size we would ever accept has
      // stopped being worth waiting for.
      if (drained > limitBytes) break;
    }
  } catch {
    // The client hung up mid-drain, which is the outcome draining exists to
    // avoid and nothing more can be done about.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Already closed or errored; the body is done with either way.
    }
  }
}
