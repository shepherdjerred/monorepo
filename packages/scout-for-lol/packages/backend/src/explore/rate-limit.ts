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
 *
 * Buckets and the active-run counters live in this process's memory, so they
 * reset on restart and would not be shared between replicas. That is exact
 * today rather than approximate: the backend deploys as a single replica with
 * the Recreate strategy (packages/homelab/src/cdk8s/src/resources/scout), so
 * there is never a second process to disagree with. Scaling this service out
 * means moving these counters to shared storage first — the quotas bound
 * model spend, and per-replica copies would multiply every ceiling by the
 * replica count.
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

/**
 * A granted turn, in two phases.
 *
 * Reserving takes the concurrency slot immediately — that is what bounds how
 * much work can be in flight — but does **not** spend quota. `commit()` does,
 * and is only called once the request has been validated and the turn is
 * actually starting. Without that split, a request with a bogus conversation
 * id was charged before anyone checked whether it referred to anything, so a
 * caller could drain the shared global allowance with requests that never ran
 * a turn.
 *
 * Both calls are idempotent, and `finish()` alone is the correct cleanup for
 * an early exit: nothing was spent yet, so there is nothing to refund.
 */
export type ExploreRateLimitTicket = {
  allowed: true;
  runId: string;
  commit: () => void;
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

const activeUserRuns = new Map<string, number>();
let activeGlobalRuns = 0;

export function getExploreQuotaStatus(
  identity: ExploreRateLimitIdentity,
  now = Date.now(),
): ExploreQuotaStatus {
  return {
    quota: engine.snapshots(identity, now),
    activeRun: (activeUserRuns.get(identity.userId) ?? 0) > 0,
  };
}

export function tryStartExploreTurn(
  identity: ExploreRateLimitIdentity,
  now = Date.now(),
): ExploreRateLimitTicket | ExploreRateLimitRejection {
  const quota = engine.snapshots(identity, now);

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

  activeUserRuns.set(
    identity.userId,
    (activeUserRuns.get(identity.userId) ?? 0) + 1,
  );
  activeGlobalRuns++;
  let finished = false;
  let committed = false;

  return {
    allowed: true,
    runId: globalThis.crypto.randomUUID(),
    // Charged against `now` rather than commit time: the window a request
    // belongs to is when it arrived, and the two are milliseconds apart.
    commit: () => {
      if (committed) {
        return;
      }
      committed = true;
      engine.consume(identity, now);
    },
    finish: () => {
      if (finished) {
        return;
      }
      finished = true;
      const activeForUser = activeUserRuns.get(identity.userId) ?? 0;
      if (activeForUser <= 1) {
        activeUserRuns.delete(identity.userId);
      } else {
        activeUserRuns.set(identity.userId, activeForUser - 1);
      }
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
