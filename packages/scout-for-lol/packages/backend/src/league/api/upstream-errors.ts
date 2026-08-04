import { z } from "zod";

/**
 * HTTP status codes from the Riot API that indicate a temporary upstream
 * outage. These are expected during maintenance windows and should not be
 * retried or reported to Sentry/Bugsink as unexpected errors.
 *
 * Two families:
 * - Standard origin 5xx (502/503/504) — Riot's own servers during maintenance.
 * - Cloudflare edge/connectivity 5xx (520–524, 527) — Riot's API is fronted by
 *   Cloudflare, which emits these when it can't get a valid response from the
 *   origin (520 unknown error, 521 down, 522 connection timeout, 523
 *   unreachable, 524 timeout, 527 railgun). These are transient edge failures,
 *   not bugs in our code; the Spectator poller sees 520 in bursts (chiefly the
 *   KOREA region) and they must route to the circuit breaker, not flood error
 *   tracking.
 *
 * 525/526 are deliberately excluded: Cloudflare returns these for invalid
 * origin certificates (526) and TLS handshake failures (525), which are
 * typically a persistent origin misconfiguration rather than a transient edge
 * condition. Silently sampling these away could hide a real, ongoing
 * certificate/TLS outage from error tracking.
 *
 * 530 is deliberately excluded: Cloudflare returns it as a wrapper for the whole
 * Error 1xxx range, which mixes transient origin conditions (e.g. 1016 origin
 * DNS) with persistent ones (1015 rate limited, 1020 access denied/firewall
 * block). The status alone cannot establish transience, so a persistent Riot-
 * side block must stay visible in error tracking rather than be silently
 * sampled away.
 */
export const EXPECTED_UPSTREAM_ERROR_STATUSES = new Set([
  502, 503, 504, 520, 521, 522, 523, 524, 527,
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
