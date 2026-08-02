/**
 * Transient-failure classification for CI scripts.
 *
 * The Buildkite retry anchor (`.buildkite/pipeline.yml`) only auto-retries
 * exit codes 255 / 34 / -1 — plain exit 1 ("logical failure") never retries.
 * Scripts that talk to external services (GitHub, ArgoCD, Cloudflare, the
 * tofu state backend) use `runMain` so that failures matching a known
 * transient signature exit with EXIT_TRANSIENT (34) and get the step's
 * automatic retry, while every other failure keeps exiting 1 and fails the
 * build immediately.
 *
 * The pattern deliberately mirrors TRANSIENT_HELM_ERROR_PATTERN in
 * packages/homelab/src/cdk8s/src/argocd-helm-render.test.ts: 5xx/network/TLS
 * signatures match; `404` / `not found` / validation errors deliberately do
 * NOT — a bad pin or a real config error must stay a hard failure.
 */

/** Exit code the pipeline's retry anchor treats as "transient, retry me". */
export const EXIT_TRANSIENT = 34;

/**
 * A failure the caller has already classified as transient — for example a
 * BuildKit/registry transport failure that `bakeFailureIsTransient` matched but
 * whose text may not match {@link TRANSIENT_ERROR_PATTERN} (e.g. `blob unknown`,
 * `context deadline exceeded`). `runMain` maps this to {@link EXIT_TRANSIENT} so
 * Buildkite auto-retries the job, independent of the message text.
 */
export class TransientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransientError";
  }
}

export const TRANSIENT_ERROR_PATTERN =
  // Explicit HTTP 5xx status signatures. A bare 5xx number is deliberately
  // excluded because Error.stack contains source line numbers, which must not
  // turn an ordinary logical failure at (for example) line 515 into a retry.
  // GitHub's GraphQL 500 envelope carries no numeric status, so its stable
  // message remains listed separately.
  // "another operation is already in progress" is ArgoCD code 9: a sync/refresh
  // op from an overlapping build or auto-sync still holds the app; the step's
  // automatic retry lands after it completes (build 6296).
  /\bHTTP(?:\/\d(?:\.\d)?)?\s+5\d\d\b|\b(?:response\s+)?status(?:\s+code)?(?:\s+|[=:]\s*)5\d\d\b|Internal Server Error|Bad Gateway|Proxy Error|Service Unavailable|Gateway Time-?out|Something went wrong while executing your query|secondary rate limit|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|i\/o timeout|TLS handshake|tls: handshake|connection reset|connection refused|temporary failure in name resolution|dial tcp|failed to open socket|unable to connect|able to access the url|another operation is already in progress/i;

const TRANSIENT_ERROR_CODES = new Set<string>([
  "ConnectionRefused",
  "ConnectionClosed",
  "ConnectionResetByPeer",
  "FailedToOpenSocket",
  "Timeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
]);

function hasTransientErrorCode(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (
    "code" in error &&
    typeof error.code === "string" &&
    TRANSIENT_ERROR_CODES.has(error.code)
  ) {
    return true;
  }
  return "cause" in error && hasTransientErrorCode(error.cause);
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof TransientError) {
    return true;
  }
  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return TRANSIENT_ERROR_PATTERN.test(text) || hasTransientErrorCode(error);
}

/**
 * Run a script's `main`, mapping a thrown transient error to EXIT_TRANSIENT
 * and everything else to exit 1. Use as the last line of a CI script in place
 * of a bare `await main()`.
 */
export async function runMain(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(error);
    if (isTransientError(error)) {
      console.error(
        `transient failure detected — exiting ${String(EXIT_TRANSIENT)} for automatic retry`,
      );
      process.exit(EXIT_TRANSIENT);
    }
    process.exit(1);
  }
}
