import { z } from "zod";

/**
 * HTTP status codes from the Riot API that indicate a temporary upstream
 * outage. These are expected during maintenance windows and should not be
 * retried or reported to Sentry/Bugsink as unexpected errors.
 */
export const EXPECTED_UPSTREAM_ERROR_STATUSES = new Set([502, 503, 504]);

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
