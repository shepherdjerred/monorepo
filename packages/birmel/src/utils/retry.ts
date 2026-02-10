import { logger } from "./logger.js";

export type RetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown) => boolean;
};

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  shouldRetry: () => true,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxAttempts) {
        break;
      }

      if (!opts.shouldRetry(error)) {
        break;
      }

      logger.debug("Retrying after error", {
        attempt,
        maxAttempts: opts.maxAttempts,
        delay,
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors
    if (error.message.includes("ECONNRESET")) {return true;}
    if (error.message.includes("ETIMEDOUT")) {return true;}
    if (error.message.includes("ECONNREFUSED")) {return true;}

    // Rate limit errors
    if (error.message.includes("rate limit")) {return true;}
    if (error.message.includes("429")) {return true;}

    // Temporary server errors
    if (error.message.includes("500")) {return true;}
    if (error.message.includes("502")) {return true;}
    if (error.message.includes("503")) {return true;}
    if (error.message.includes("504")) {return true;}
  }

  return false;
}

export function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  return retry(fn, {
    maxAttempts,
    shouldRetry: isRetryableError,
  });
}
