/** The error an aborted signal carries, always an `Error` so it can be thrown or rejected. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

/** Settle with `work`, or reject as soon as `signal` aborts; `work` itself keeps running. */
export async function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  const aborted = Promise.withResolvers<never>();
  const onAbort = () => {
    aborted.reject(abortReason(signal));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  // Raced even when already aborted, so a rejection of `work` is always observed.
  if (signal.aborted) onAbort();
  try {
    return await Promise.race([work, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** The wait line for a slot is full: the caller is refused instead of piling up. */
export class QueueFullError extends Error {
  constructor() {
    super("The upstream call queue is full");
    this.name = "QueueFullError";
  }
}

/**
 * Counting semaphore: callers past the limit wait their turn in a bounded line, callers past the
 * line are refused, and an aborted waiter leaves.
 */
export class Slots {
  private free: number;
  private readonly waiting: (() => void)[] = [];

  constructor(
    limit: number,
    private readonly maxWaiting: number,
  ) {
    this.free = limit;
  }

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.free > 0) {
      this.free -= 1;
      return () => {
        this.release();
      };
    }
    if (this.waiting.length >= this.maxWaiting) throw new QueueFullError();
    const turn = Promise.withResolvers<undefined>();
    const wake = () => {
      turn.resolve(undefined);
    };
    this.waiting.push(wake);
    const onAbort = () => {
      const index = this.waiting.indexOf(wake);
      if (index !== -1) this.waiting.splice(index, 1);
      turn.reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await turn.promise;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    return () => {
      this.release();
    };
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next === undefined) this.free += 1;
    else next();
  }
}

/** A small expiring cache; the oldest entry goes first when it is full. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; until: number }>();

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    return hit !== undefined && hit.until > Date.now() ? hit.value : undefined;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, until: Date.now() + this.ttlMs });
  }
}

/**
 * A TTL cache that also coalesces identical concurrent requests, so many viewers asking for the
 * same thing cause one upstream call. One caller leaving does not cancel the shared call.
 */
export class CoalescingCache<T> {
  private readonly cache: TtlCache<T>;
  private readonly flights = new Map<string, Promise<T>>();

  constructor(capacity: number, ttlMs: number) {
    this.cache = new TtlCache<T>(capacity, ttlMs);
  }

  async resolve(
    key: string,
    signal: AbortSignal,
    produce: () => Promise<T>,
  ): Promise<T> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let flight = this.flights.get(key);
    if (flight === undefined) {
      flight = this.run(key, produce);
      this.flights.set(key, flight);
    }
    return await abortable(flight, signal);
  }

  private async run(key: string, produce: () => Promise<T>): Promise<T> {
    // Yield first so the flight is registered before `produce` can fail synchronously.
    await Promise.resolve();
    try {
      const value = await produce();
      this.cache.set(key, value);
      return value;
    } finally {
      this.flights.delete(key);
    }
  }
}
