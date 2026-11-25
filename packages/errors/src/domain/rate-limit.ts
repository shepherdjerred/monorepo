export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly rateLimitHeader: string;
};

export type IngestRateLimiterOptions = {
  readonly projectBurst?: number | undefined;
  readonly projectRefillPerSec?: number | undefined;
  readonly ipBurst?: number | undefined;
  readonly ipRefillPerSec?: number | undefined;
  readonly maxEntries?: number | undefined;
};

export type IngestRateLimiter = {
  readonly consume: (input: {
    readonly projectId: number;
    readonly ip: string;
    readonly nowMs?: number | undefined;
  }) => RateLimitDecision;
};

type TokenBucket = {
  tokens: number;
  updatedAtMs: number;
};

function refillBucket(
  bucket: TokenBucket,
  capacity: number,
  refillPerSec: number,
  nowMs: number,
): void {
  const elapsedSeconds = Math.max(0, (nowMs - bucket.updatedAtMs) / 1000);
  bucket.tokens = Math.min(
    capacity,
    bucket.tokens + elapsedSeconds * refillPerSec,
  );
  bucket.updatedAtMs = nowMs;
}

function getOrCreateBucket(
  map: Map<string, TokenBucket>,
  key: string,
  capacity: number,
  options: { readonly nowMs: number; readonly maxEntries: number },
): TokenBucket {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  if (map.size >= options.maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    }
  }
  const created: TokenBucket = { tokens: capacity, updatedAtMs: options.nowMs };
  map.set(key, created);
  return created;
}

export function createIngestRateLimiter(
  options?: IngestRateLimiterOptions,
): IngestRateLimiter {
  const projectBurst = options?.projectBurst ?? 120;
  const projectRefillPerSec = options?.projectRefillPerSec ?? 2;
  const ipBurst = options?.ipBurst ?? 60;
  const ipRefillPerSec = options?.ipRefillPerSec ?? 1;
  const maxEntries = options?.maxEntries ?? 10_000;

  const projectBuckets = new Map<string, TokenBucket>();
  const ipBuckets = new Map<string, TokenBucket>();

  return {
    consume: ({ projectId, ip, nowMs }) => {
      const now = nowMs ?? Date.now();
      const projectKey = String(projectId);
      const ipKey = `${projectKey}:${ip}`;

      const projectBucket = getOrCreateBucket(
        projectBuckets,
        projectKey,
        projectBurst,
        { nowMs: now, maxEntries },
      );
      const ipBucket = getOrCreateBucket(ipBuckets, ipKey, ipBurst, {
        nowMs: now,
        maxEntries,
      });

      refillBucket(projectBucket, projectBurst, projectRefillPerSec, now);
      refillBucket(ipBucket, ipBurst, ipRefillPerSec, now);

      if (projectBucket.tokens < 1 || ipBucket.tokens < 1) {
        const projectWait =
          projectBucket.tokens < 1
            ? (1 - projectBucket.tokens) / projectRefillPerSec
            : 0;
        const ipWait =
          ipBucket.tokens < 1 ? (1 - ipBucket.tokens) / ipRefillPerSec : 0;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(Math.max(projectWait, ipWait)),
        );
        return {
          allowed: false,
          retryAfterSeconds,
          rateLimitHeader: `${String(retryAfterSeconds)}:error:project`,
        };
      }

      projectBucket.tokens -= 1;
      ipBucket.tokens -= 1;
      return {
        allowed: true,
        retryAfterSeconds: 0,
        rateLimitHeader: "0:error:project",
      };
    },
  };
}
