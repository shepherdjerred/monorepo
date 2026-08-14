/**
 * Fixed-window quota buckets shared by the AI rate limiters.
 *
 * A bucket starts when its first request lands and expires a whole window
 * later — deliberately not aligned to the wall clock, so a user who spends a
 * daily allowance at 23:59 does not get a fresh one a minute later.
 *
 * State is in-memory and therefore per-process. Scout runs a single replica,
 * so that is the real limit; a second replica would double every allowance
 * and the state would need to move to the database.
 */

export type QuotaWindow = "minute" | "hour" | "day" | "week";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export const QUOTA_WINDOW_MS: Record<QuotaWindow, number> = {
  minute: MINUTE_MS,
  hour: HOUR_MS,
  day: DAY_MS,
  week: WEEK_MS,
};

export type QuotaRule<Scope extends string> = {
  scope: Scope;
  window: QuotaWindow;
  limit: number;
};

export type QuotaSnapshot<Scope extends string> = {
  scope: Scope;
  window: QuotaWindow;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
};

export type QuotaEngine<Scope extends string, Identity> = {
  /** Current usage for every rule, without consuming anything. */
  snapshots: (identity: Identity, now: number) => QuotaSnapshot<Scope>[];
  /** Charge one request against every rule. */
  consume: (identity: Identity, now: number) => void;
  /** Test-only: drop all bucket state. */
  reset: () => void;
};

type Bucket = {
  startedAt: number;
  used: number;
};

export function createQuotaEngine<Scope extends string, Identity>(options: {
  rules: QuotaRule<Scope>[];
  /** Maps a rule's scope plus the caller's identity to a bucket key. */
  scopeKey: (scope: Scope, identity: Identity) => string;
}): QuotaEngine<Scope, Identity> {
  const buckets = new Map<string, Bucket>();

  const bucketId = (rule: QuotaRule<Scope>, identity: Identity): string =>
    `${rule.scope}:${rule.window}:${options.scopeKey(rule.scope, identity)}`;

  const currentBucket = (
    rule: QuotaRule<Scope>,
    identity: Identity,
    now: number,
  ): Bucket => {
    const id = bucketId(rule, identity);
    const existing = buckets.get(id);
    if (
      existing !== undefined &&
      now - existing.startedAt < QUOTA_WINDOW_MS[rule.window]
    ) {
      return existing;
    }
    const bucket = { startedAt: now, used: 0 };
    buckets.set(id, bucket);
    return bucket;
  };

  return {
    snapshots: (identity, now) =>
      options.rules.map((rule) => {
        const bucket = currentBucket(rule, identity, now);
        const used = Math.min(rule.limit, bucket.used);
        return {
          scope: rule.scope,
          window: rule.window,
          used,
          limit: rule.limit,
          remaining: Math.max(0, rule.limit - used),
          resetsAt: new Date(
            bucket.startedAt + QUOTA_WINDOW_MS[rule.window],
          ).toISOString(),
        };
      }),
    consume: (identity, now) => {
      for (const rule of options.rules) {
        currentBucket(rule, identity, now).used++;
      }
    },
    reset: () => {
      buckets.clear();
    },
  };
}

export function quotaSecondsUntil(resetsAt: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(resetsAt) - now) / 1000));
}
