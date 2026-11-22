import { Temporal } from "@js-temporal/polyfill";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";

import { UpstreamUnavailableError } from "#application/ops-errors";
import type { SeriesPort, SeriesRangeRequest } from "#application/ports";
import { toContractDate } from "#shared/time";

const DEFAULT_MAX_CONCURRENCY = 6;
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 256;

type RangeResult = Awaited<ReturnType<SeriesPort["range"]>>;

type CacheEntry = {
  value: RangeResult;
  expiresAtMs: number;
};

type InflightEntry = {
  promise: Promise<RangeResult>;
  controller: AbortController;
  subscribers: number;
};

export type PrometheusSeriesOptions = {
  fetch?: Fetch;
  nowMs?: () => number;
  ttlMs?: number;
  maxEntries?: number;
  maxConcurrency?: number;
};

function toSeconds(seconds: number): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(seconds * 1000);
}

function cacheKey(request: SeriesRangeRequest): string {
  return `${request.promql}|${String(request.startSeconds)}|${String(request.endSeconds)}|${String(request.stepSeconds)}`;
}

function abortedError(): UpstreamUnavailableError {
  return new UpstreamUnavailableError("prometheus", "request aborted");
}

function unavailable(error: unknown): UpstreamUnavailableError {
  if (error instanceof UpstreamUnavailableError) {
    return error;
  }
  const message =
    error instanceof Error ? error.message.slice(0, 300) : "request failed";
  return new UpstreamUnavailableError("prometheus", message);
}

class Semaphore {
  readonly #max: number;
  #active = 0;
  readonly #queue: { grant: () => void }[] = [];

  constructor(max: number) {
    this.#max = max;
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) {
      return Promise.reject(abortedError());
    }
    if (this.#active < this.#max) {
      this.#active += 1;
      return Promise.resolve(() => {
        this.#release();
      });
    }
    return new Promise<() => void>((resolve, reject) => {
      const onAbort = () => {
        const index = this.#queue.indexOf(waiter);
        if (index !== -1) {
          this.#queue.splice(index, 1);
        }
        reject(abortedError());
      };
      const waiter = {
        grant: () => {
          signal.removeEventListener("abort", onAbort);
          resolve(() => {
            this.#release();
          });
        },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#queue.push(waiter);
    });
  }

  #release(): void {
    const next = this.#queue.shift();
    if (next !== undefined) {
      next.grant();
      return;
    }
    this.#active -= 1;
  }
}

/**
 * Prometheus behind the series port, bounded by a concurrency semaphore,
 * singleflight deduplication, and a short TTL cache so bursts of Hub charts do
 * not stampede Prometheus. Every failure surfaces as `UpstreamUnavailableError`.
 */
export class PrometheusSeries implements SeriesPort {
  readonly #client: PrometheusClient;
  readonly #semaphore: Semaphore;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #inflight = new Map<string, InflightEntry>();
  readonly #nowMs: () => number;
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(baseUrl: string, options: PrometheusSeriesOptions = {}) {
    this.#client = new PrometheusClient({
      baseUrl,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    this.#semaphore = new Semaphore(
      options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    );
    this.#nowMs = options.nowMs ?? (() => performance.now());
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async range(
    request: SeriesRangeRequest,
    signal?: AbortSignal,
  ): Promise<RangeResult> {
    if (signal?.aborted === true) {
      throw abortedError();
    }
    const key = cacheKey(request);
    const cached = this.#readCache(key);
    if (cached !== undefined) {
      return cached;
    }
    const shared = this.#getOrStartInflight(key, request);
    return this.#awaitSubscriber(shared, signal);
  }

  async scalar(promql: string): Promise<number | null> {
    try {
      return await this.#client.scalar(promql);
    } catch (error) {
      throw unavailable(error);
    }
  }

  #readCache(key: string): RangeResult | undefined {
    const entry = this.#cache.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAtMs <= this.#nowMs()) {
      this.#cache.delete(key);
      return undefined;
    }
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    return entry.value;
  }

  #writeCache(key: string, value: RangeResult): void {
    const now = this.#nowMs();
    if (this.#cache.size >= this.#maxEntries) {
      for (const [candidateKey, candidate] of this.#cache) {
        if (candidate.expiresAtMs <= now) {
          this.#cache.delete(candidateKey);
        }
      }
    }
    while (this.#cache.size >= this.#maxEntries) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#cache.delete(oldest);
    }
    this.#cache.set(key, { value, expiresAtMs: now + this.#ttlMs });
  }

  #getOrStartInflight(key: string, request: SeriesRangeRequest): InflightEntry {
    const existing = this.#inflight.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const controller = new AbortController();
    const promise = this.#executeRange(key, request, controller.signal);
    const created: InflightEntry = { promise, controller, subscribers: 0 };
    this.#inflight.set(key, created);
    return created;
  }

  async #executeRange(
    key: string,
    request: SeriesRangeRequest,
    signal: AbortSignal,
  ): Promise<RangeResult> {
    try {
      const release = await this.#semaphore.acquire(signal);
      try {
        if (signal.aborted) {
          throw abortedError();
        }
        const value = await this.#client.range(
          {
            query: request.promql,
            start: toContractDate(toSeconds(request.startSeconds)),
            end: toContractDate(toSeconds(request.endSeconds)),
            stepSeconds: request.stepSeconds,
          },
          signal,
        );
        this.#writeCache(key, value);
        return value;
      } finally {
        release();
      }
    } catch (error) {
      throw unavailable(error);
    } finally {
      this.#inflight.delete(key);
    }
  }

  async #awaitSubscriber(
    entry: InflightEntry,
    signal: AbortSignal | undefined,
  ): Promise<RangeResult> {
    entry.subscribers += 1;
    if (signal === undefined) {
      return entry.promise;
    }
    const state = { aborted: false };
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => {
        state.aborted = true;
        entry.subscribers -= 1;
        if (entry.subscribers <= 0) {
          entry.controller.abort();
        }
        reject(abortedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([entry.promise, abortPromise]);
    } catch (error) {
      throw state.aborted ? abortedError() : unavailable(error);
    } finally {
      if (onAbort !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }
}
