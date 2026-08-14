import type {
  DiscordAccountId,
  ExploreQuotaScope,
  ExploreQuotaSnapshot,
} from "@scout-for-lol/data";
import {
  createQuotaEngine,
  quotaSecondsUntil,
  type QuotaRule,
} from "#src/utils/quota-buckets.ts";

/**
 * Explore quotas are per person, not per server.
 *
 * The report editor charges a guild because a report belongs to one; an
 * explore conversation belongs to a user and reads the whole lake, so a guild
 * scope would mean nothing. Limits are looser than the editor's because a
 * conversation is many small turns rather than one expensive draft, but a
 * global ceiling still bounds total spend if several people explore at once.
 */

export type ExploreRateLimitIdentity = {
  userId: DiscordAccountId;
};

export type ExploreQuotaStatus = {
  quota: ExploreQuotaSnapshot[];
  activeRun: boolean;
};

export type ExploreRateLimitRejection = {
  allowed: false;
  quota: ExploreQuotaSnapshot[];
  retryAfterSeconds: number;
  reason: string;
};

export type ExploreRateLimitTicket = {
  allowed: true;
  runId: string;
  quota: ExploreQuotaSnapshot[];
  finish: () => void;
};

const MAX_ACTIVE_GLOBAL_RUNS = 5;

const QUOTA_RULES: QuotaRule<ExploreQuotaScope>[] = [
  { scope: "user", window: "minute", limit: 4 },
  { scope: "user", window: "hour", limit: 30 },
  { scope: "user", window: "day", limit: 100 },
  { scope: "user", window: "week", limit: 300 },
  { scope: "global", window: "hour", limit: 120 },
  { scope: "global", window: "day", limit: 600 },
  { scope: "global", window: "week", limit: 2000 },
];

const engine = createQuotaEngine<ExploreQuotaScope, ExploreRateLimitIdentity>({
  rules: QUOTA_RULES,
  scopeKey: (scope, identity) =>
    scope === "global" ? "global" : identity.userId,
});

const activeUserRuns = new Set<string>();
let activeGlobalRuns = 0;

export function getExploreQuotaStatus(
  identity: ExploreRateLimitIdentity,
  now = Date.now(),
): ExploreQuotaStatus {
  return {
    quota: engine.snapshots(identity, now),
    activeRun: activeUserRuns.has(identity.userId),
  };
}

export function tryStartExploreTurn(
  identity: ExploreRateLimitIdentity,
  now = Date.now(),
): ExploreRateLimitTicket | ExploreRateLimitRejection {
  const quota = engine.snapshots(identity, now);

  // A conversation is sequential — a second concurrent turn would race the
  // transcript it is supposed to be continuing.
  if (activeUserRuns.has(identity.userId)) {
    return {
      allowed: false,
      quota,
      retryAfterSeconds: 30,
      reason: "You already have a question running. Wait for it to finish.",
    };
  }

  if (activeGlobalRuns >= MAX_ACTIVE_GLOBAL_RUNS) {
    return {
      allowed: false,
      quota,
      retryAfterSeconds: 30,
      reason: "Explore is busy right now. Try again shortly.",
    };
  }

  const limited = quota.find((snapshot) => snapshot.remaining === 0);
  if (limited !== undefined) {
    return {
      allowed: false,
      quota,
      retryAfterSeconds: quotaSecondsUntil(limited.resetsAt, now),
      reason: quotaReason(limited),
    };
  }

  engine.consume(identity, now);
  activeUserRuns.add(identity.userId);
  activeGlobalRuns++;
  let finished = false;

  return {
    allowed: true,
    runId: globalThis.crypto.randomUUID(),
    quota: engine.snapshots(identity, now),
    finish: () => {
      if (finished) {
        return;
      }
      finished = true;
      activeUserRuns.delete(identity.userId);
      activeGlobalRuns = Math.max(0, activeGlobalRuns - 1);
    },
  };
}

export function resetExploreRateLimitStateForTests(): void {
  engine.reset();
  activeUserRuns.clear();
  activeGlobalRuns = 0;
}

function quotaReason(snapshot: ExploreQuotaSnapshot): string {
  const subject = snapshot.scope === "user" ? "You have" : "Explore has";
  return `${subject} used ${snapshot.used.toString()} of ${snapshot.limit.toString()} questions for this ${snapshot.window}.`;
}
