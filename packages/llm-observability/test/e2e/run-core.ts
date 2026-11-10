/**
 * Where the suite finds Tempo and MinIO, handed from the runner that started
 * them to the vitest process through its environment.
 *
 * The two runners differ here and nowhere else: docker compose publishes both
 * on localhost (`run.ts`), while in Woodpecker each is its own pod, reached by
 * its service name as a hostname (`run-ci.ts`).
 */
export const E2E_TEMPO_HOST_VARIABLE = "LLM_OBSERVABILITY_E2E_TEMPO_HOST";
export const E2E_MINIO_HOST_VARIABLE = "LLM_OBSERVABILITY_E2E_MINIO_HOST";

/**
 * How long to poll Tempo for a flushed trace. Tempo's complete_block_timeout
 * in this suite is 1s; the default server timeout is 10s, so 15s is the
 * deadline for "the trace never became queryable".
 */
export const TEMPO_TRACE_POLL_TIMEOUT_MS = 15_000;

/**
 * Vitest budget for the gateway archive test. It must outlive the Tempo poll
 * so a slow-but-present trace is not killed at Vitest's 5s default, and a
 * missing trace still fails from the poll rather than from the test timeout.
 */
export const GATEWAY_ARCHIVE_E2E_TIMEOUT_MS =
  TEMPO_TRACE_POLL_TIMEOUT_MS + 10_000;

export type E2eHosts = { readonly tempo: string; readonly minio: string };

export function e2eEnvironment(hosts: E2eHosts): Record<string, string> {
  return {
    [E2E_TEMPO_HOST_VARIABLE]: hosts.tempo,
    [E2E_MINIO_HOST_VARIABLE]: hosts.minio,
  };
}

export async function waitForTempo(
  ready: () => Promise<boolean>,
  attempts = 60,
  delayMilliseconds = 1000,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await ready()) return;
    await Bun.sleep(delayMilliseconds);
  }
  throw new Error(`Tempo did not become ready within ${attempts.toString()}s`);
}
