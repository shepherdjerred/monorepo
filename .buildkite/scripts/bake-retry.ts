const transient =
  /Request timed out|i\/o timeout|TLS handshake|remote error: tls|connection reset|connection refused|net\/http:|failed to do request|dial tcp|temporary failure in name resolution|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|blob unknown|failed to resolve source metadata|unexpected EOF|error reading from server: EOF|failed to receive status|graceful_stop|panic: send on closed channel|context deadline exceeded|error: failed to download/i;

export type BuildxCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export function bakeFailureIsTransient(log: string): boolean {
  return transient.test(log.split("\n").slice(-120).join("\n"));
}

async function defaultDelay(delayMs: number): Promise<void> {
  await Bun.sleep(delayMs);
}

/**
 * Retry only transport-class BuildKit failures. Deterministic solve failures
 * return immediately with their original status. Exhausted transient failures
 * return the pipeline's declared transient status so Buildkite can retry the
 * whole job after a daemon rollout or network interruption.
 */
export async function retryTransientBuildx(
  run: () => Promise<BuildxCommandResult>,
  delay: (delayMs: number) => Promise<void> = defaultDelay,
): Promise<number> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await run();
    if (result.exitCode === 0) return 0;
    if (!bakeFailureIsTransient(`${result.stdout}${result.stderr}`)) {
      return result.exitCode;
    }
    if (attempt === 3) return 34;

    const delayMs = attempt * attempt * 15_000;
    console.error(
      `Transient BuildKit failure; retrying attempt ${(attempt + 1).toString()}/3 in ${delayMs.toString()}ms`,
    );
    await delay(delayMs);
  }
  throw new Error("BuildKit retry loop exhausted without returning");
}
