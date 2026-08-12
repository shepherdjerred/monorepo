export type TempoForwarder = {
  forward: (payload: string) => Promise<void>;
};

// The ingest handler awaits this inside the request path, so an unbounded
// fetch would let a hung Tempo stall delivery handling and exhaust
// concurrency. Failures are surfaced, retried by OpenRouter, and deduplicated
// by the digest receipt, so a bounded wait is strictly better than hanging.
const FORWARD_TIMEOUT_MS = 15_000;
const ERROR_BODY_LIMIT = 2000;

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
        const errorBody = await response.text();
        const body = errorBody.slice(0, ERROR_BODY_LIMIT);
        throw new Error(
          `Tempo OTLP forwarding failed (${String(response.status)}): ${body}`,
        );
      }
    },
  };
}
