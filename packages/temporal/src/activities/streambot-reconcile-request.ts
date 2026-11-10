import { z } from "zod";

/**
 * Transport error codes meaning the connection was refused or reset before
 * Streambot returned a response. Bun's fetch reports a refused connection as
 * `ConnectionRefused` and a reset as `ECONNRESET`; the Node spelling
 * `ECONNREFUSED` and Bun's `ConnectionResetByPeer` are the same conditions.
 * These happen while the single Streambot replica is recreated during a
 * rollout.
 */
const REFUSED_OR_RESET_CODES = new Set([
  "ConnectionRefused",
  "ECONNREFUSED",
  "ECONNRESET",
  "ConnectionResetByPeer",
]);

/**
 * Delays before each retry of a refused or reset connection. Each sleep
 * observes the request signal, so retries never outlast the request deadline
 * or Activity cancellation.
 */
export const STREAMBOT_RECONCILE_RETRY_DELAYS_MS = [
  1000, 2000, 4000, 8000, 15_000,
] as const;

export function isRefusedOrResetConnection(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = z.string().safeParse(Reflect.get(error, "code"));
  return code.success && REFUSED_OR_RESET_CODES.has(code.data);
}

export type StreambotReconcileRequest = {
  url: URL;
  token: string;
  signal: AbortSignal;
  fetch: (url: URL, init: RequestInit) => Promise<Response>;
  /** Must reject once `signal` aborts. */
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

/**
 * POSTs Streambot's reconcile endpoint, retrying only when the connection is
 * refused or reset before a response arrives. Reconciliation is idempotent:
 * it converges playback on durable ownership, so a repeated request after a
 * reset is safe. HTTP error statuses, timeouts, aborts and every other
 * transport failure are returned or thrown on the first occurrence.
 */
export async function postStreambotReconcile(
  request: StreambotReconcileRequest,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request.fetch(request.url, {
        method: "POST",
        headers: { authorization: `Bearer ${request.token}` },
        signal: request.signal,
      });
    } catch (error) {
      const delay = STREAMBOT_RECONCILE_RETRY_DELAYS_MS[attempt];
      if (!isRefusedOrResetConnection(error)) {
        throw error;
      }
      if (delay === undefined) {
        throw new Error(
          `Streambot reconciliation could not connect after ${String(attempt + 1)} attempts`,
          { cause: error },
        );
      }
      await request.sleep(delay, request.signal);
    }
  }
}
