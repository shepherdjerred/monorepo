type BoundedAsyncCacheOptions = {
  ttlMs: number;
  maxEntries: number;
  maxConcurrent: number;
  now: () => number;
};

export function createBoundedAsyncCache<Result>(
  options: BoundedAsyncCacheOptions,
): (key: string, load: () => Promise<Result>) => Promise<Result> {
  const cache = new Map<string, { expiresAt: number; result: Result }>();
  const inFlight = new Map<string, Promise<Result>>();
  const waiters: (() => void)[] = [];
  let active = 0;

  async function withSlot(load: () => Promise<Result>): Promise<Result> {
    if (active >= options.maxConcurrent) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
    active++;
    try {
      return await load();
    } finally {
      active--;
      const next = waiters.shift();
      if (next !== undefined) next();
    }
  }

  return async (key, load) => {
    const now = options.now();
    for (const [cachedKey, value] of cache) {
      if (value.expiresAt <= now) cache.delete(cachedKey);
    }
    const cached = cache.get(key);
    if (cached !== undefined) return cached.result;
    const running = inFlight.get(key);
    if (running !== undefined) return await running;
    const promise = withSlot(load);
    inFlight.set(key, promise);
    try {
      const result = await promise;
      cache.set(key, { expiresAt: options.now() + options.ttlMs, result });
      while (cache.size > options.maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return result;
    } finally {
      inFlight.delete(key);
    }
  };
}
