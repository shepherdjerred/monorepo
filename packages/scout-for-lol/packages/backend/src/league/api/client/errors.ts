import { z } from "zod";

/**
 * Expected upstream outage status codes from Riot API / Cloudflare Edge.
 */
export const EXPECTED_UPSTREAM_STATUS_CODES = new Set([
  502, // Bad Gateway
  503, // Service Unavailable (Riot API maintenance / server load)
  504, // Gateway Timeout
  520, // Cloudflare: Web Server Returned an Unknown Error
  522, // Cloudflare: Connection Timed Out
  524, // Cloudflare: A Timeout Occurred
]);

export type RiotHttpErrorOptions = {
  status: number;
  statusText: string;
  body: unknown;
  url: string;
  headers: Headers;
};

/**
 * Custom error thrown when a Riot API HTTP request returns a non-2xx response.
 */
export class RiotHttpError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly body: unknown;
  public readonly url: string;
  public readonly headers: Headers;
  public readonly riotTraceId?: string;

  constructor(options: RiotHttpErrorOptions) {
    super(
      `Riot API HTTP ${options.status.toString()} (${options.statusText}) for ${options.url}`,
    );
    this.name = "RiotHttpError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.body = options.body;
    this.url = options.url;
    this.headers = options.headers;
    const traceId = options.headers.get("x-riot-edge-trace-id");
    if (traceId) {
      this.riotTraceId = traceId;
    }
  }
}

const HttpStatusShape = z.object({
  status: z.number().int(),
});

/**
 * Extract HTTP status code from an unknown error (RiotHttpError or status-bearing object).
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (error instanceof RiotHttpError) {
    return error.status;
  }
  const parsed = HttpStatusShape.safeParse(error);
  return parsed.success ? parsed.data.status : undefined;
}

/**
 * Checks whether an HTTP status code is an expected upstream outage (502, 503, 504, 520, 522, 524).
 */
export function isExpectedUpstreamStatus(status: number): boolean {
  return EXPECTED_UPSTREAM_STATUS_CODES.has(status);
}

/**
 * Checks whether an HTTP status code is a rate limit error (429).
 */
export function isRateLimitStatus(status: number): boolean {
  return status === 429;
}
