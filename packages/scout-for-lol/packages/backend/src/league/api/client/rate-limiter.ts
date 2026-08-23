import { RiotHttpError } from "./errors.ts";

export type RequestExecutor = () => Promise<Response>;

export type RateLimiterOptions = {
  /** Maximum number of concurrent in-flight requests. Default: 5. */
  concurrency?: number | undefined;
  /** Maximum retry attempts on 429 / 503. Default: 3. */
  maxRetries?: number | undefined;
};

async function parseResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }
}

/**
 * Lightweight in-memory semaphore and rate-limit retry executor for Riot API calls.
 */
export class RateLimiter {
  private activeCount = 0;
  private readonly queue: (() => void)[] = [];
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;

  constructor(options: RateLimiterOptions = {}) {
    this.maxConcurrency = options.concurrency ?? 5;
    this.maxRetries = options.maxRetries ?? 3;
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

  /**
   * Execute an HTTP request with concurrency management and automatic retry on 429 / 503.
   */
  public async execute(
    url: string,
    executeRequest: RequestExecutor,
  ): Promise<Response> {
    let attempts = 0;

    while (attempts <= this.maxRetries) {
      attempts += 1;

      const response = await this.schedule(executeRequest);

      if (response.ok) {
        return response;
      }

      const status = response.status;

      // 429: Rate Limit Exceeded
      if (status === 429 && attempts <= this.maxRetries) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader
          ? Number.parseInt(retryAfterHeader, 10)
          : 1;
        const delayMs =
          (Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1) * 1000 +
          Math.random() * 200;
        await Bun.sleep(delayMs);
        continue;
      }

      // 503: Service Unavailable (Riot API server overload / temporary outage)
      if (status === 503 && attempts <= this.maxRetries) {
        const baseDelayMs = 1000 * 2 ** (attempts - 1);
        const delayMs = baseDelayMs + Math.random() * 300;
        await Bun.sleep(delayMs);
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
      `Exceeded maximum retry attempts (${this.maxRetries.toString()}) for ${url}`,
    );
  }
}
