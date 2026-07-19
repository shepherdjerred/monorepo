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

export const TRANSIENT_ERROR_PATTERN =
  // 5xx status signatures (incl. GitHub's GraphQL 500 envelope, which carries
  // no numeric status: "Something went wrong while executing your query").
  /\b(?:500|502|503|504)\b|Internal Server Error|Bad Gateway|Proxy Error|Service Unavailable|Gateway Timeout|Something went wrong while executing your query|secondary rate limit|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|i\/o timeout|TLS handshake|tls: handshake|connection reset|connection refused|temporary failure in name resolution|dial tcp/i;

export function isTransientError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return TRANSIENT_ERROR_PATTERN.test(text);
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
