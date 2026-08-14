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

import { TransientError } from "./transient-error.ts";

/** Exit code the pipeline's retry anchor treats as "transient, retry me". */
export const EXIT_TRANSIENT = 34;

export const TRANSIENT_ERROR_PATTERN =
  // Explicit HTTP 5xx status signatures. A bare 5xx number is deliberately
  // excluded because Error.stack contains source line numbers, which must not
  // turn an ordinary logical failure at (for example) line 515 into a retry.
  // GitHub's GraphQL 500 envelope carries no numeric status, so its stable
  // message remains listed separately.
  // "another operation is already in progress" is ArgoCD code 9: a sync/refresh
  // op from an overlapping build or auto-sync still holds the app; the step's
  // automatic retry lands after it completes (build 6296).
  // "socket connection was closed unexpectedly" is Bun's fetch transport error
  // (the textual form of the ConnectionClosed code below). Octokit wraps it in
  // a synthetic HTTP 500 whose body is undefined, so no other 5xx signature in
  // this pattern appears — release-please died on it in build 9421.
  /\bHTTP(?:\/\d(?:\.\d)?)?\s+5\d\d\b|\b(?:response\s+)?status(?:\s+code)?(?:\s+|[=:]\s*)5\d\d\b|Internal Server Error|Bad Gateway|Proxy Error|Service Unavailable|Gateway Time-?out|Something went wrong while executing your query|secondary rate limit|socket connection was closed unexpectedly|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|i\/o timeout|TLS handshake|tls: handshake|connection reset|connection refused|temporary failure in name resolution|dial tcp|failed to open socket|unable to connect|able to access the url|another operation is already in progress/i;

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

/**
 * ANSI color/cursor sequences (`ESC [` … digits/semicolons … a letter). Built
 * from a computed escape byte rather than a regex literal so the control
 * character never appears in source. Deliberately narrower than the full CSI
 * grammar: this exists to undo terminal styling on tool diagnostics, and every
 * styling sequence CI tools emit ends in a letter (`m`, `K`, `J`, …).
 */
const ANSI_STYLE_PATTERN = new RegExp(
  String.fromCodePoint(0x1b) + String.raw`\[[\d;?]*[a-z]`,
  "gi",
);

/**
 * Remove terminal color codes before pattern matching.
 *
 * `run()` embeds a tail of the failed command's stderr in the thrown error, and
 * those tools colorize their own diagnostics when the pipeline forces color. Bun
 * prints an octokit failure as `status<ESC>[0m<ESC>[2m:<ESC>[0m <ESC>[33m500`,
 * which splits the literal `status: 500` the 5xx signature looks for across four
 * escape sequences — so an uncolored 5xx retried while the identical colored one
 * hard-failed the build (build 9421). Strip the escapes so classification
 * depends on the diagnostic's text, not on whether a TTY was attached.
 */
export function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_STYLE_PATTERN, "");
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof TransientError) {
    return true;
  }
  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return (
    TRANSIENT_ERROR_PATTERN.test(stripAnsi(text)) ||
    hasTransientErrorCode(error)
  );
}

/**
 * Run a script's `main`, mapping a thrown transient error to EXIT_TRANSIENT
 * and everything else to exit 1. Use as the last line of a CI script in place
 * of a bare `await main()`.
 */
export async function runMain(
  main: () => Promise<void>,
  exit: (code: number) => never = (code) => process.exit(code),
): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(error);
    if (isTransientError(error)) {
      console.error(
        `transient failure detected — exiting ${String(EXIT_TRANSIENT)} for automatic retry`,
      );
      exit(EXIT_TRANSIENT);
    }
    exit(1);
  }
}
