import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import {
  createQuotaEngine,
  quotaSecondsUntil,
  type QuotaRule,
  type QuotaSnapshot,
} from "#src/utils/quota-buckets.ts";

type BucksAskQuotaScope = "user" | "guild";

export type BucksAskRateLimitIdentity = {
  userId: DiscordAccountId;
  serverId: DiscordGuildId;
};

export type BucksAskRateLimitTicket = {
  allowed: true;
  commit: () => void;
  finish: () => void;
};

export type BucksAskRateLimitRejection = {
  allowed: false;
  reason: string;
  retryAfterSeconds: number;
};

const MAX_ACTIVE_GLOBAL_RUNS = 2;
const QUOTA_RULES: QuotaRule<BucksAskQuotaScope>[] = [
  { scope: "user", window: "minute", limit: 2 },
  { scope: "user", window: "hour", limit: 20 },
  { scope: "guild", window: "hour", limit: 40 },
];

const engine = createQuotaEngine<BucksAskQuotaScope, BucksAskRateLimitIdentity>(
  {
    rules: QUOTA_RULES,
    scopeKey: (scope, identity) =>
      scope === "user" ? identity.userId : identity.serverId,
  },
);

const activeUsers = new Set<DiscordAccountId>();
let activeGlobalRuns = 0;

export function getBucksAskQuotaStatus(
  identity: BucksAskRateLimitIdentity,
  now = Date.now(),
): {
  quota: QuotaSnapshot<BucksAskQuotaScope>[];
  active: boolean;
  activeGlobalRuns: number;
} {
  return {
    quota: engine.snapshots(identity, now),
    active: activeUsers.has(identity.userId),
    activeGlobalRuns,
  };
}

export function tryStartBucksAsk(
  identity: BucksAskRateLimitIdentity,
  now = Date.now(),
): BucksAskRateLimitTicket | BucksAskRateLimitRejection {
  const quota = engine.snapshots(identity, now);
  if (activeUsers.has(identity.userId)) {
    return {
      allowed: false,
      reason: "You already have a Bryan Bucks question running.",
      retryAfterSeconds: 30,
    };
  }
  if (activeGlobalRuns >= MAX_ACTIVE_GLOBAL_RUNS) {
    return {
      allowed: false,
      reason: "Bryan Bucks analysis is busy right now.",
      retryAfterSeconds: 30,
    };
  }
  const limited = quota.find((snapshot) => snapshot.remaining === 0);
  if (limited !== undefined) {
    return {
      allowed: false,
      reason:
        limited.scope === "user"
          ? `You have used ${limited.used.toString()} of ${limited.limit.toString()} questions for this ${limited.window}.`
          : `This server has used ${limited.used.toString()} of ${limited.limit.toString()} questions for this ${limited.window}.`,
      retryAfterSeconds: quotaSecondsUntil(limited.resetsAt, now),
    };
  }

  activeUsers.add(identity.userId);
  activeGlobalRuns++;
  let committed = false;
  let finished = false;
  return {
    allowed: true,
    commit: () => {
      if (committed) return;
      committed = true;
      engine.consume(identity, now);
    },
    finish: () => {
      if (finished) return;
      finished = true;
      activeUsers.delete(identity.userId);
      activeGlobalRuns--;
    },
  };
}

export function resetBucksAskRateLimitStateForTests(): void {
  engine.reset();
  activeUsers.clear();
  activeGlobalRuns = 0;
}
