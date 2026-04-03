/**
 * Timing utility for Dagger operations.
 * Wraps async operations with duration logging.
 */

/** Wrap an async operation with timing. Logs duration to stderr. */
export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    console.error(`[TIMING] ${label}: ${duration}ms`);
    return result;
  } catch (e) {
    const duration = Date.now() - start;
    console.error(`[TIMING] ${label}: FAILED after ${duration}ms`);
    throw e;
  }
}
