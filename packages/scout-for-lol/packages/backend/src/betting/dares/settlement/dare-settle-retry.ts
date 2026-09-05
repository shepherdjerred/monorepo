/**
 * A short, bounded, linear-backoff retry.
 *
 * Generic over the attempted operation so the retry mechanism is testable
 * independently of what it wraps — used to give one dare's capture
 * transaction a few chances to clear a transient database error before the
 * postmatch poll gives up on it. Mirrors `retryCustomVoiceOperation` in
 * `customs/voice-service.ts`.
 */

/** Retry attempts for one dare's capture transaction. Bounded and short: a
 * genuine multi-minute outage should page rather than hold the whole
 * postmatch poll hostage retrying one dare. */
export const DARE_SETTLE_ATTEMPTS = 3;

export async function withBoundedRetry<T>(
  attempt: () => Promise<T>,
  attempts: number,
  delay: (milliseconds: number) => Promise<void> = async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
): Promise<T> {
  let lastError: unknown;
  for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (attemptNumber < attempts) {
        await delay(50 * attemptNumber);
      }
    }
  }
  throw lastError;
}
