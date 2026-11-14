import {
  SCOUT_DESKTOP_API_ERRORS,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  SCOUT_DESKTOP_CONTRACT_VERSION,
  SCOUT_DESKTOP_MINIMUM_CONTRACT_VERSION,
  ScoutDesktopApiErrorSchema,
  type ScoutDesktopApiErrorCode,
} from "@scout-for-lol/data";

/**
 * Responses on the desktop REST surface. Every one names the server's
 * contract version, so a client can tell it is talking to an older or newer
 * backend without a separate request.
 */
export function desktopHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    [SCOUT_DESKTOP_CONTRACT_HEADER]: String(SCOUT_DESKTOP_CONTRACT_VERSION),
  };
}

export function desktopJsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: desktopHeaders() });
}

/**
 * A typed refusal from `desktop-api.contract.json`, at its declared status.
 *
 * `retryAfterSeconds` overrides the `Retry-After` a refusal carries; the body
 * stays `{ error, message }` on every route.
 */
export function desktopErrorResponse(
  error: ScoutDesktopApiErrorCode,
  message: string,
  options: { readonly retryAfterSeconds?: number } = {},
): Response {
  const response = Response.json(
    ScoutDesktopApiErrorSchema.parse({ error, message }),
    { status: SCOUT_DESKTOP_API_ERRORS[error], headers: desktopHeaders() },
  );
  const retryAfter =
    options.retryAfterSeconds ?? (error === "rate_limited" ? 60 : undefined);
  if (retryAfter !== undefined) {
    response.headers.set("Retry-After", String(retryAfter));
  }
  return response;
}

const CONTRACT_VERSION_PATTERN = /^\d{1,6}$/;

/**
 * The contract version a request declares, or null when this server no
 * longer speaks it. A missing or malformed header is the same as an old
 * client: every build that knows these routes sends it.
 */
export function acceptedContractVersion(request: Request): number | null {
  const header = request.headers.get(SCOUT_DESKTOP_CONTRACT_HEADER);
  const version =
    header !== null && CONTRACT_VERSION_PATTERN.test(header)
      ? Number(header)
      : null;
  return version !== null && version >= SCOUT_DESKTOP_MINIMUM_CONTRACT_VERSION
    ? version
    : null;
}

export function contractUnsupportedResponse(): Response {
  return desktopErrorResponse(
    "contract_unsupported",
    "Update Scout Desktop to keep using Explore.",
  );
}

/** Refuse a client whose contract predates the oldest one still spoken. */
export function contractRefusal(request: Request): Response | null {
  return acceptedContractVersion(request) === null
    ? contractUnsupportedResponse()
    : null;
}
