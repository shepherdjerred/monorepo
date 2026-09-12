import { createLogger } from "#src/logger.ts";
import {
  riotApiAppRateLimitCount,
  riotApiAppRateLimitLimit,
} from "#src/metrics/riot-rate-limit.ts";
import { isExpectedUpstreamError, RiotHttpError } from "./errors.ts";
import { parseAppRateLimitWindows } from "./rate-limit-headers.ts";

const logger = createLogger("rate-limiter");

export type RequestExecutor = () => Promise<Response>;

export type RateLimiterOptions = {
  /** Maximum number of concurrent in-flight requests. Default: 5. */
  concurrency?: number | undefined;
  /**
   * Maximum retry attempts on 429 and expected upstream outages
   * (502/503/504/520/522/524). Default: 3.
   */
  maxRetries?: number | undefined;
};

export type RateLimitedRequestOptions = {
  /** Override automatic retries for one request without bypassing the limiter. */
  maxRetries?: number | undefined;
  /**
   * Whether to retry expected upstream outages (502/503/504/520/522/524).
   * Default: true. Set to false for non-idempotent requests (e.g. a POST
   * that mints a resource): Riot may have already processed the request
   * even though its response was lost, so retrying could duplicate the
   * side effect. 429 retries are unaffected by this option — Riot's rate
   * limiter rejects those before the request reaches any handler, so
   * retrying a 429 is always safe regardless of method.
   */
  retryUpstreamErrors?: boolean | undefined;
};

type RateLimiterRuntime = {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
};

const DEFAULT_RETRY_AFTER_MS = 1000;

const defaultRuntime: RateLimiterRuntime = {
  now: Date.now,
  sleep: Bun.sleep,
  random: Math.random,
};

async function parseResponseBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}

function retryAfterMilliseconds(response: Response): number {
  const header = response.headers.get("retry-after");
  if (header === null || header.trim().length === 0) {
    return DEFAULT_RETRY_AFTER_MS;
  }

  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : DEFAULT_RETRY_AFTER_MS;
}

/**
 * Lightweight in-memory semaphore and rate-limit retry executor for Riot API calls.
 */
export class RateLimiter {
  private activeCount = 0;
  private readonly queue: (() => void)[] = [];
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly runtime: RateLimiterRuntime;
  private blockedUntil = 0;

  constructor(
    options: RateLimiterOptions = {},
    runtime: RateLimiterRuntime = defaultRuntime,
  ) {
    this.maxConcurrency = options.concurrency ?? 5;
    this.maxRetries = options.maxRetries ?? 3;
    this.runtime = runtime;
  }

  private async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.activeCount -= 1;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Execute an async task through the concurrency limiter.
   */
  public async schedule<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async waitForCooldown(): Promise<void> {
    let remainingMilliseconds = this.blockedUntil - this.runtime.now();
    while (remainingMilliseconds > 0) {
      await this.runtime.sleep(remainingMilliseconds);
      remainingMilliseconds = this.blockedUntil - this.runtime.now();
    }
  }

  private extendCooldown(response: Response): void {
    const delayMilliseconds =
      retryAfterMilliseconds(response) + this.runtime.random() * 200;
    this.blockedUntil = Math.max(
      this.blockedUntil,
      this.runtime.now() + delayMilliseconds,
    );
  }

  private async executeAttempt(
    executeRequest: RequestExecutor,
  ): Promise<Response> {
    await this.acquire();
    try {
      await this.waitForCooldown();
      const response = await executeRequest();

      for (const window of parseAppRateLimitWindows(response.headers)) {
        const labels = { window_seconds: window.windowSeconds.toString() };
        riotApiAppRateLimitCount.set(labels, window.count);
        riotApiAppRateLimitLimit.set(labels, window.limit);
      }

      if (response.status === 429) {
        // Establish the shared cooldown before releasing the semaphore slot so
        // queued calls cannot start during Riot's Retry-After window.
        this.extendCooldown(response);
      }
      return response;
    } finally {
      this.release();
    }
  }

  /**
   * Execute an HTTP request with concurrency management and automatic retry
   * on 429 and expected upstream outages (502/503/504/520/522/524).
   */
  public async execute(
    url: string,
    executeRequest: RequestExecutor,
    options: RateLimitedRequestOptions = {},
  ): Promise<Response> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let attempts = 0;

    while (attempts <= maxRetries) {
      attempts += 1;

      const response = await this.executeAttempt(executeRequest);

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const retryUpstreamErrors = options.retryUpstreamErrors ?? true;

      // 429 (Rate Limit Exceeded) and expected upstream outages
      // (502/503/504/520/522/524) are retried with backoff. Upstream-outage
      // retries can be disabled per request for non-idempotent calls.
      const isRetryableStatus =
        status === 429 ||
        (retryUpstreamErrors && isExpectedUpstreamError(status));
      if (isRetryableStatus && attempts <= maxRetries) {
        if (status === 429) {
          logger.info(
            `429 from Riot API (attempt ${attempts.toString()}/${maxRetries.toString()}) for ${url}; cooldown extended via Retry-After`,
          );
          continue;
        }

        const baseDelayMs = 1000 * 2 ** (attempts - 1);
        const delayMs = baseDelayMs + this.runtime.random() * 300;
        logger.warn(
          `${status.toString()} from Riot API (expected upstream outage, attempt ${attempts.toString()}/${maxRetries.toString()}) for ${url}; retrying in ${delayMs.toFixed(0)}ms`,
        );
        await this.runtime.sleep(delayMs);
        continue;
      }

      // Permanent failure or exhausted retries
      const body = await parseResponseBody(response);

      throw new RiotHttpError({
        status,
        statusText: response.statusText,
        body,
        url,
        headers: response.headers,
      });
    }

    throw new Error(
      `Exceeded maximum retry attempts (${maxRetries.toString()}) for ${url}`,
    );
  }
}
