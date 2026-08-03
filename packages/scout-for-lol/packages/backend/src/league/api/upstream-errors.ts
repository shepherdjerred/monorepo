import { z } from "zod";

/**
 * HTTP status codes from the Riot API that indicate a temporary upstream
 * outage. These are expected during maintenance windows and should not be
 * retried or reported to Sentry/Bugsink as unexpected errors.
 *
 * Two families:
 * - Standard origin 5xx (502/503/504) — Riot's own servers during maintenance.
 * - Cloudflare edge 5xx (520–527, 530) — Riot's API is fronted by Cloudflare,
 *   which emits these when it can't get a valid response from the origin (520
 *   unknown error, 521 down, 522 connection timeout, 523 unreachable, 524
 *   timeout, 525/526 SSL, 527 railgun, 530 origin DNS). These are transient
 *   edge failures, not bugs in our code; the Spectator poller sees 520 in bursts
 *   (chiefly the KOREA region) and they must route to the circuit breaker, not
 *   flood error tracking.
 */
export const EXPECTED_UPSTREAM_ERROR_STATUSES = new Set([
  502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530,
]);

const HttpStatusShape = z.object({ status: z.coerce.number().int() });

/**
 * Extract the HTTP status code from a twisted GenericError-shaped value. The
 * `status` field is not strongly typed by twisted so it may arrive as either
 * a number or a string; `z.coerce.number()` handles both.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  const parsed = HttpStatusShape.safeParse(error);
  return parsed.success ? parsed.data.status : undefined;
}

export function isExpectedUpstreamError(status: number | undefined): boolean {
  return status !== undefined && EXPECTED_UPSTREAM_ERROR_STATUSES.has(status);
}
