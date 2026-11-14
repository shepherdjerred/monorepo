import { createLogger } from "#src/logger.ts";
import {
  riotApi429Total,
  riotApiAppRateLimitCount,
  riotApiAppRateLimitLimit,
  riotApiLimiterDecisionsTotal,
  riotApiLimiterWaitSeconds,
  riotApiMethodRateLimitCount,
  riotApiMethodRateLimitLimit,
} from "#src/metrics/riot-rate-limit.ts";
import {
  isExpectedUpstreamError,
  RiotHttpError,
  RiotTransportError,
} from "./errors.ts";
import {
  methodKeyOfUrl,
  parseAppRateLimitWindows,
  parseMethodRateLimitWindows,
  parseRateLimitType,
  routeOfUrl,
} from "./rate-limit-headers.ts";
import {
  RIOT_PRIORITIES,
  RiotBudgetLedger,
  type RiotBudgetMode,
  type RiotPriority,
} from "./rate-budget.ts";

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
  /**
   * Concurrency slots only `realtime` requests may take, so a saturating
   * lower class can never hold every slot. Default: 1 (0 when concurrency is
   * 1). Must be less than `concurrency`.
   */
  reservedRealtimeSlots?: number | undefined;
  /**
   * Read on every attempt, so an operator's change lands on the next request.
   * Default: always `observe`.
   */
  budgetMode?: (() => RiotBudgetMode) | undefined;
  /** Shared budget ledger. Default: a new ledger on the limiter's clock. */
  ledger?: RiotBudgetLedger | undefined;
};

export type RateLimitedRequestOptions = {
  /**
   * Which class this request belongs to. Untagged requests are `realtime`, so
   * a call site is only ever demoted deliberately.
   */
  priority?: RiotPriority | undefined;
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
const MAX_SERVICE_BACKOFF_MS = 30_000;

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

function explicitRetryAfterMilliseconds(
  response: Response,
): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null || header.trim().length === 0) {
    return undefined;
  }

  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function retryAfterMilliseconds(response: Response): number {
  return explicitRetryAfterMilliseconds(response) ?? DEFAULT_RETRY_AFTER_MS;
}

/**
 * Exponential backoff for a service 429: 1s, 2s, 4s, ... capped at 30s, never
 * shorter than an explicit Retry-After, plus up to 300ms of jitter.
 */
function serviceBackoffMilliseconds(
  response: Response,
  attempt: number,
  random: number,
): number {
  const exponential = Math.min(
    MAX_SERVICE_BACKOFF_MS,
    DEFAULT_RETRY_AFTER_MS * 2 ** (attempt - 1),
  );
  const retryAfter = explicitRetryAfterMilliseconds(response) ?? 0;
  return Math.max(exponential, retryAfter) + random * 300;
}

function cooldownKey(route: string, method?: string): string {
  return method === undefined ? route : `${route}|${method}`;
}

function newQueues(): Record<RiotPriority, (() => void)[]> {
  return { realtime: [], interactive: [], backfill: [], crawl: [] };
}

/**
 * In-memory priority semaphore and rate-limit retry executor for Riot API
 * calls.
 *
 * Waiting requests queue per priority class, and a freed slot goes to the
 * highest class waiting; `reservedRealtimeSlots` of the slots serve only
 * `realtime`. Retry-After cooldowns are scoped to what Riot limited: the
 * routing host for an application (or unclassified) 429, the host and
 * endpoint for a method 429. A service 429 is Riot shedding load rather than
 * a budget signal, so it backs off only the request that received it.
 *
 * Every attempt also consults the `RiotBudgetLedger`. In `observe` mode the
 * decision is recorded and the request is admitted regardless; in `enforce`
 * mode a refused request gives up its slot until the ledger's wait elapses.
 */
export class RateLimiter {
  private activeCount = 0;
  private readonly queues = newQueues();
  private readonly maxConcurrency: number;
  private readonly reservedRealtimeSlots: number;
  private readonly maxRetries: number;
  private readonly runtime: RateLimiterRuntime;
  private readonly budgetMode: () => RiotBudgetMode;
  private readonly ledger: RiotBudgetLedger;
  /** Retry-After deadlines keyed by `cooldownKey`. */
  private readonly blockedUntil = new Map<string, number>();

  constructor(
    options: RateLimiterOptions = {},
    runtime: RateLimiterRuntime = defaultRuntime,
  ) {
    this.maxConcurrency = options.concurrency ?? 5;
    this.reservedRealtimeSlots =
      options.reservedRealtimeSlots ?? (this.maxConcurrency > 1 ? 1 : 0);
    if (
      this.reservedRealtimeSlots < 0 ||
      this.reservedRealtimeSlots >= this.maxConcurrency
    ) {
      throw new Error(
        `reservedRealtimeSlots (${this.reservedRealtimeSlots.toString()}) must be at least 0 and less than concurrency (${this.maxConcurrency.toString()})`,
      );
    }
    this.maxRetries = options.maxRetries ?? 3;
    this.runtime = runtime;
    this.budgetMode = options.budgetMode ?? (() => "observe");
    this.ledger =
      options.ledger ?? new RiotBudgetLedger({ clock: () => runtime.now() });
  }

  private hasCapacityFor(priority: RiotPriority): boolean {
    const slots =
      priority === "realtime"
        ? this.maxConcurrency
        : this.maxConcurrency - this.reservedRealtimeSlots;
    return this.activeCount < slots;
  }

  /** Whether a request of this class or a higher one is already waiting. */
  private hasWaitingAtOrAbove(priority: RiotPriority): boolean {
    for (const candidate of RIOT_PRIORITIES) {
      if (this.queues[candidate].length > 0) {
        return true;
      }
      if (candidate === priority) {
        return false;
      }
    }
    return false;
  }

  private async acquire(priority: RiotPriority): Promise<void> {
    if (!this.hasWaitingAtOrAbove(priority) && this.hasCapacityFor(priority)) {
      this.activeCount += 1;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queues[priority].push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.activeCount -= 1;
    for (const priority of RIOT_PRIORITIES) {
      const queue = this.queues[priority];
      while (queue.length > 0 && this.hasCapacityFor(priority)) {
        queue.shift()?.();
      }
    }
  }

  /**
   * Execute an async task through the concurrency limiter.
   */
  public async schedule<T>(
    task: () => Promise<T>,
    priority: RiotPriority = "realtime",
  ): Promise<T> {
    await this.acquire(priority);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private cooldownDeadline(route: string, method: string): number {
    return Math.max(
      this.blockedUntil.get(cooldownKey(route)) ?? 0,
      this.blockedUntil.get(cooldownKey(route, method)) ?? 0,
    );
  }

  private extendCooldown(key: string, response: Response): void {
    const delayMilliseconds =
      retryAfterMilliseconds(response) + this.runtime.random() * 200;
    this.blockedUntil.set(
      key,
      Math.max(
        this.blockedUntil.get(key) ?? 0,
        this.runtime.now() + delayMilliseconds,
      ),
    );
  }

  /**
   * Releases the slot while a cooldown runs, then asks the ledger, and returns holding a slot. In
   * `observe` mode a refusal is only recorded; in `enforce` mode it releases
   * the slot for the ledger's wait and queues again.
   */
  private async awaitAdmission(
    route: string,
    method: string,
    priority: RiotPriority,
  ): Promise<void> {
    for (;;) {
      const cooldownMilliseconds =
        this.cooldownDeadline(route, method) - this.runtime.now();
      if (cooldownMilliseconds > 0) {
        // Never sleep holding a slot: a cooling scope would starve others.
        this.release();
        await this.runtime.sleep(cooldownMilliseconds);
        await this.acquire(priority);
        continue;
      }
      const decision = this.ledger.admit({ route, method, priority });
      if (decision.ok) {
        riotApiLimiterDecisionsTotal.inc({
          route,
          priority,
          outcome: "admitted",
          reason: "none",
        });
        return;
      }
      if (this.budgetMode() === "observe") {
        riotApiLimiterDecisionsTotal.inc({
          route,
          priority,
          outcome: "would_defer",
          reason: decision.reason,
        });
        // Sent anyway, so it must hold a reservation its response releases.
        this.ledger.reserve(route, method);
        return;
      }
      riotApiLimiterDecisionsTotal.inc({
        route,
        priority,
        outcome: "deferred",
        reason: decision.reason,
      });
      this.release();
      await this.runtime.sleep(decision.waitMs);
      await this.acquire(priority);
    }
  }

  private async executeAttempt(
    url: string,
    executeRequest: RequestExecutor,
    priority: RiotPriority,
  ): Promise<Response> {
    const route = routeOfUrl(url);
    const method = methodKeyOfUrl(url);
    const queuedAt = this.runtime.now();
    await this.acquire(priority);
    try {
      await this.awaitAdmission(route, method, priority);
      riotApiLimiterWaitSeconds.observe(
        { priority },
        (this.runtime.now() - queuedAt) / 1000,
      );
      let response: Response;
      try {
        response = await executeRequest();
      } catch (error) {
        this.ledger.abandon(route, method);
        throw new RiotTransportError(url, error);
      }

      this.ledger.observe(route, method, response.headers);
      for (const window of parseAppRateLimitWindows(response.headers)) {
        const labels = {
          route,
          window_seconds: window.windowSeconds.toString(),
        };
        riotApiAppRateLimitCount.set(labels, window.count);
        riotApiAppRateLimitLimit.set(labels, window.limit);
      }
      for (const window of parseMethodRateLimitWindows(response.headers)) {
        const labels = {
          route,
          method,
          window_seconds: window.windowSeconds.toString(),
        };
        riotApiMethodRateLimitCount.set(labels, window.count);
        riotApiMethodRateLimitLimit.set(labels, window.limit);
      }

      if (response.status === 429) {
        const limitType = parseRateLimitType(response.headers);
        riotApi429Total.inc({ route, limit_type: limitType, priority });
        this.ledger.recordRateLimited(route, method, response.headers);
        // Establish the cooldown before releasing the semaphore slot so
        // queued calls cannot start during Riot's Retry-After window. A
        // service 429 sets none: execute() backs off that request alone.
        if (limitType === "method") {
          this.extendCooldown(cooldownKey(route, method), response);
        } else if (limitType !== "service") {
          this.extendCooldown(cooldownKey(route), response);
        }
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
    const priority = options.priority ?? "realtime";
    let attempts = 0;

    while (attempts <= maxRetries) {
      attempts += 1;

      const response = await this.executeAttempt(url, executeRequest, priority);

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
          if (parseRateLimitType(response.headers) === "service") {
            const delayMs = serviceBackoffMilliseconds(
              response,
              attempts,
              this.runtime.random(),
            );
            logger.info(
              `Service 429 from Riot API (attempt ${attempts.toString()}/${maxRetries.toString()}) for ${url}; backing off ${delayMs.toFixed(0)}ms`,
            );
            await this.runtime.sleep(delayMs);
            continue;
          }
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
