/**
 * Short-lived cache for Riot-backed suggestion runs.
 *
 * One suggestion run costs up to ~40 Riot calls, so repeat visits, reloads,
 * and manual-add refetches within a few minutes must not each pay full price.
 * Entries are keyed by the exact query input; concurrent callers share one
 * in-flight fetch. Failures are never cached — the next caller retries live.
 */

export type SuggestionCache<T> = {
  getOrFetch: (key: string, fetch: () => Promise<T>) => Promise<T>;
};

export function createSuggestionCache<T>(opts: {
  ttlMs: number;
  now?: () => number;
}): SuggestionCache<T> {
  const now = opts.now ?? Date.now;
  const settled = new Map<string, { expiresAt: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();

  async function runFetch(key: string, fetch: () => Promise<T>): Promise<T> {
    try {
      const value = await fetch();
      settled.set(key, { expiresAt: now() + opts.ttlMs, value });
      return value;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    async getOrFetch(key, fetch) {
      const hit = settled.get(key);
      if (hit !== undefined && hit.expiresAt > now()) {
        return hit.value;
      }
      settled.delete(key);
      const running = inflight.get(key);
      if (running !== undefined) return running;
      const next = runFetch(key, fetch);
      inflight.set(key, next);
      return next;
    },
  };
}
