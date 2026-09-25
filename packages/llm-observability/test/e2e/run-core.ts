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
