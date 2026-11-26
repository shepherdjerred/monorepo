/**
 * One structured line to stderr. Callers pass ids and counts only: a content
 * token, comment body or path must never reach a log line.
 */
export function logEvent(
  message: string,
  fields: Record<string, string | number | boolean> = {},
) {
  console.warn(JSON.stringify({ message, ...fields }));
}

/** Reports an unexpected failure without the request, which could carry a token. */
export function reportError(error: unknown, context = "unexpected_error") {
  console.error(
    JSON.stringify({
      message: context,
      errorType: error instanceof Error ? error.name : typeof error,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}
