import type { MiddlewareHandler } from "hono";

import type {
  IdempotencyRecord,
  IdempotencyStore,
} from "../idempotency/store.ts";

export const MUTATION_ID_HEADER = "X-Mutation-Id";
export const REPLAY_HEADER = "X-Idempotent-Replay";

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE"]);

function replayResponse(record: IdempotencyRecord): Response {
  return new Response(record.body, {
    status: record.status,
    headers: {
      "content-type": "application/json",
      [REPLAY_HEADER]: "true",
    },
  });
}

/**
 * Deduplicates replayed client mutations.
 *
 * The app's offline queue sends a client-generated id in `X-Mutation-Id`
 * with every mutating request. If the server already executed that mutation
 * (client crashed between receiving the ack and dequeuing), the stored
 * response is replayed verbatim with `X-Idempotent-Replay: true` instead of
 * executing twice — this is what makes queue replay safe for non-idempotent
 * operations like create.
 *
 * Register AFTER the envelope middleware so both the stored body and the
 * replayed body are pre-envelope (the envelope wraps them identically on
 * the way out). Only 2xx responses are stored: failed mutations had no
 * side effect worth deduplicating, and retrying them is desired.
 */
export function idempotencyMiddleware(
  store: IdempotencyStore,
): MiddlewareHandler {
  // Concurrent requests carrying the same mutation id (e.g. a connection
  // retry fired while the original is still in flight) must not both
  // execute. The second waits for the first to settle, then replays its
  // stored record — falling through to execute only if the first failed
  // (nothing stored).
  const inFlight = new Map<string, Promise<null>>();

  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) return next();
    if (!c.req.path.startsWith("/api/")) return next();
    const mutationId = c.req.header(MUTATION_ID_HEADER);
    if (mutationId === undefined || mutationId === "") return next();

    let pending = inFlight.get(mutationId);
    while (pending !== undefined) {
      await pending;
      pending = inFlight.get(mutationId);
    }

    const hit = store.get(mutationId);
    if (hit !== undefined) {
      return replayResponse(hit);
    }

    const { promise: gate, resolve: release } = Promise.withResolvers<null>();
    inFlight.set(mutationId, gate);

    try {
      await next();

      const response = c.res;
      const isJson =
        response.headers.get("content-type")?.includes("application/json") ===
        true;
      if (response.status < 200 || response.status >= 300 || !isJson) return;

      // Reconstruct the response BEFORE persisting: the mutation already
      // executed, so the client must receive its success even if the
      // record can't be written. A 500 here would force a retry of an
      // applied mutation — the exact duplicate this middleware exists to
      // prevent. A failed persist only degrades a *future* replay.
      const bodyText = await response.text();
      c.res = new Response(bodyText, {
        status: response.status,
        headers: response.headers,
      });
      try {
        await store.put({
          id: mutationId,
          method: c.req.method,
          path: c.req.path,
          status: response.status,
          body: bodyText,
          ts: Date.now(),
        });
      } catch (error) {
        console.error(
          `idempotency: failed to persist record for ${mutationId} — replays of this mutation will re-execute`,
          error,
        );
      }
    } finally {
      inFlight.delete(mutationId);
      release(null);
    }
  };
}
