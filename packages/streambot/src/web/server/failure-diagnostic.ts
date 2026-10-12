type FailureKind =
  | "timeout"
  | "aborted"
  | "network"
  | "invalid_data"
  | "type_error"
  | "aggregate"
  | "internal"
  | "unknown"
  | "depth_limit";

type FailureDiagnostic = {
  kind: FailureKind;
  causes?: FailureDiagnostic[];
};

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
]);

function failureKind(error: unknown): FailureKind {
  if (!(error instanceof Error)) return "unknown";
  if (error.name === "TimeoutError") return "timeout";
  if (error.name === "AbortError") return "aborted";
  if (
    "code" in error &&
    typeof error.code === "string" &&
    NETWORK_CODES.has(error.code)
  )
    return "network";
  if (error instanceof AggregateError) return "aggregate";
  if (error instanceof SyntaxError) return "invalid_data";
  return error instanceof TypeError ? "type_error" : "internal";
}

/** Closed categories only: provider errors can contain private URLs and credentials. */
export function webFailureDiagnostic(
  error: unknown,
  depth = 0,
): FailureDiagnostic {
  if (depth >= 3) return { kind: "depth_limit" };
  const kind = failureKind(error);
  if (error instanceof AggregateError)
    return {
      kind,
      causes: error.errors
        .slice(0, 8)
        .map((cause: unknown) => webFailureDiagnostic(cause, depth + 1)),
    };
  return error instanceof Error && error.cause !== undefined
    ? { kind, causes: [webFailureDiagnostic(error.cause, depth + 1)] }
    : { kind };
}

const ENDPOINTS = new Set([
  "/healthz",
  "/readyz",
  "/api/auth/discord/start",
  "/api/auth/discord/callback",
  "/api/auth/logout",
  "/api/me",
  "/api/commands",
  "/api/subtitles",
  "/api/player",
  "/api/artwork",
  "/api/sports",
  "/api/library",
  "/api/search",
  "/api/history",
]);

export function webFailureEndpoint(request: Request): string {
  const path = new URL(request.url).pathname;
  return ENDPOINTS.has(path) ? path : "other";
}
