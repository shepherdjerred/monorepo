/**
 * HTTP status codes from the Riot API that indicate a temporary upstream
 * outage. These are expected during maintenance windows and should not be
 * reported to Bugsink as unexpected errors.
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
 * A request that did not receive an HTTP response from Riot. These failures
 * are an expected external-boundary condition, distinct from local database
 * and persisted-contract failures that callers must surface.
 */
export class RiotTransportError extends Error {
  public readonly url: string;

  constructor(url: string, cause: unknown) {
    super(`Riot API transport failure for ${url}`, { cause });
    this.name = "RiotTransportError";
    this.url = url;
  }
}

/** An application capture hook failed after a successful upstream response. */
export class RiotPayloadCaptureError extends Error {
  constructor(cause: unknown) {
    super("Riot response capture failed", { cause });
    this.name = "RiotPayloadCaptureError";
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

/**
 * Riot's definitive answer that it will not serve a resource: 403 for a
 * match it withholds (for example a client-only custom) and 404 for one it
 * does not have. Unlike an outage or timeout, retrying cannot change it.
 */
export type RiotSourceAbsence = "forbidden" | "not_found";

export function riotSourceAbsence(
  error: unknown,
): RiotSourceAbsence | undefined {
  const status = extractHttpStatus(error);
  if (status === 403) return "forbidden";
  return status === 404 ? "not_found" : undefined;
}

/**
 * Route segments that are identifiers rather than part of the endpoint's
 * shape, keyed by the segment that precedes them. Riot's match ids carry a
 * platform prefix (`NA1_123`), so the template must not leave them in place.
 */
const IDENTIFIER_AFTER_SEGMENT: ReadonlyMap<string, string> = new Map([
  ["matches", "{matchId}"],
  ["by-puuid", "{puuid}"],
  ["by-summoner", "{puuid}"],
  ["teams", "{teamId}"],
]);

/**
 * Stable Bugsink grouping key for a Riot request URL: host and route with
 * identifiers replaced and the query string dropped, so one endpoint failing
 * for many matches or players is one issue rather than one per id.
 */
export function endpointTemplate(url: string): string {
  if (!URL.canParse(url)) {
    // Only test doubles construct errors with bare labels; there is no route
    // to normalize. This runs inside Bugsink's beforeSend, which must not
    // throw and lose the event it is grouping.
    return url.split("?", 1)[0] ?? url;
  }
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/");
  const templated = segments.map((segment, index) => {
    if (segment === "by-riot-id" || IDENTIFIER_AFTER_SEGMENT.has(segment))
      return segment;
    if (segments[index - 1] === "by-riot-id") return "{gameName}";
    if (segments[index - 2] === "by-riot-id") return "{tagLine}";
    const previous = segments[index - 1];
    return previous === undefined
      ? segment
      : (IDENTIFIER_AFTER_SEGMENT.get(previous) ?? segment);
  });
  return `${parsed.host}${templated.join("/")}`;
}
