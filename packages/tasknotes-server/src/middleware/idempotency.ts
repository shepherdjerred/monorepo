import type { MiddlewareHandler } from "hono";

import type { IdempotencyStore } from "../idempotency/store.ts";

export const MUTATION_ID_HEADER = "X-Mutation-Id";
export const REPLAY_HEADER = "X-Idempotent-Replay";

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE"]);

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
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) return next();
    if (!c.req.path.startsWith("/api/")) return next();
    const mutationId = c.req.header(MUTATION_ID_HEADER);
    if (mutationId === undefined || mutationId === "") return next();

    const hit = store.get(mutationId);
    if (hit !== undefined) {
      return new Response(hit.body, {
        status: hit.status,
        headers: {
          "content-type": "application/json",
          [REPLAY_HEADER]: "true",
        },
      });
    }

    await next();

    const response = c.res;
    const isJson =
      response.headers.get("content-type")?.includes("application/json") ===
      true;
    if (response.status < 200 || response.status >= 300 || !isJson) return;

    const bodyText = await response.text();
    await store.put({
      id: mutationId,
      method: c.req.method,
      path: c.req.path,
      status: response.status,
      body: bodyText,
      ts: Date.now(),
    });
    c.res = new Response(bodyText, {
      status: response.status,
      headers: response.headers,
    });
  };
}
