export type TempoForwarder = {
  forward: (payload: string) => Promise<void>;
};

// The ingest handler awaits this inside the request path, so an unbounded
// fetch would let a hung Tempo stall delivery handling and exhaust
// concurrency. Failures are surfaced, retried by OpenRouter, and deduplicated
// by the digest receipt, so a bounded wait is strictly better than hanging.
const FORWARD_TIMEOUT_MS = 15_000;
const ERROR_BODY_LIMIT = 2000;

/**
 * Reads at most `ERROR_BODY_LIMIT` characters of a diagnostic body, then
 * cancels the stream. Slicing the result of `.text()` would enforce the bound
 * only after the whole payload was already buffered, so a large or unending
 * error body could exhaust the pod's memory or keep the handler occupied long
 * after the forwarding timeout stopped covering it.
 */
async function boundedErrorBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < ERROR_BODY_LIMIT) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text.slice(0, ERROR_BODY_LIMIT);
  } finally {
    await reader.cancel();
  }
}

export function createTempoForwarder(url: string): TempoForwarder {
  return {
    async forward(payload) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
      if (!response.ok) {
        // An error body is diagnostic only; never allocate an arbitrarily
        // large string for one.
        const body = await boundedErrorBody(response.body);
        throw new Error(
          `Tempo OTLP forwarding failed (${String(response.status)}): ${body}`,
        );
      }
    },
  };
}
