/**
 * HTTP status codes from the Riot API that indicate a temporary upstream
 * outage. These are expected during maintenance windows and should not be
 * reported to Sentry/Bugsink as unexpected errors.
 *
 * The standard origin failures are 502/503/504. Cloudflare 520/522/524 are
 * included because Scout has observed them as transient Riot edge failures.
 * Other Cloudflare statuses remain visible because they can indicate durable
 * DNS, firewall, or TLS configuration failures.
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
    if (traceId !== null && traceId.length > 0) {
      this.riotTraceId = traceId;
    }
  }
}

/**
 * Extract an HTTP status only from the error type owned by the Riot client.
 * This keeps similarly shaped errors from Discord and other APIs out of Riot's
 * upstream-error policy.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  return error instanceof RiotHttpError ? error.status : undefined;
}

/**
 * Checks whether an HTTP status code is an expected upstream outage (502, 503, 504, 520, 522, 524).
 */
export function isExpectedUpstreamError(status: number | undefined): boolean {
  return status !== undefined && EXPECTED_UPSTREAM_STATUS_CODES.has(status);
}
