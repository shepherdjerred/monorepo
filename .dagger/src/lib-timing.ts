/**
 * Timing and logging utilities for CI/CD pipelines
 */

/**
 * Log a message with timestamp prefix
 *
 * @param message - The message to log
 */
export function logWithTimestamp(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Execute an async function and log its execution time
 *
 * @param name - Name of the operation for logging
 * @param fn - Async function to execute
 * @returns The result of the function
 */
export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  logWithTimestamp(`Starting: ${name}`);

  try {
    const result = await fn();
    const duration = ((performance.now() - start) / 1000).toFixed(2);
    logWithTimestamp(`Completed: ${name} (${duration}s)`);
    return result;
  } catch (error) {
    const duration = ((performance.now() - start) / 1000).toFixed(2);
    const msg = error instanceof Error ? error.message : String(error);
    logWithTimestamp(`Failed: ${name} (${duration}s): ${msg.slice(0, 500)}`);
    throw error;
  }
}

const GRAPHQL_ERROR_PATTERN = "error while requesting data via graphql";

/**
 * Execute an async function with timing and automatic retry on transient
 * Dagger GraphQL errors (kube-pod:// transport instability).
 */
export async function withTimingAndRetry<T>(
  name: string,
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  return withTiming(name, async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isGraphqlError = msg.includes(GRAPHQL_ERROR_PATTERN);
        if (!isGraphqlError || attempt === maxRetries) {
          throw error;
        }
        logWithTimestamp(
          `⟳ ${name}: graphql error on attempt ${String(attempt + 1)}, retrying...`,
        );
      }
    }
    throw new Error("unreachable");
  });
}

/**
 * Format a duration in milliseconds to a human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes)}m ${remainingSeconds.toFixed(0)}s`;
}
