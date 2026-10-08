import type {
  DiscordAccountId,
  ExploreQuotaScope,
  ExploreQuotaSnapshot,
} from "@scout-for-lol/data";
import {
  createQuotaEngine,
  quotaSecondsUntil,
} from "#src/utils/quota-buckets.ts";
import { exploreQuotaLimits } from "#src/config/dynamic.ts";
import {
  EXPLORE_MAX_ACTIVE_RUNS,
  exploreQuotaRules,
} from "#src/configuration/explore-quota.ts";

/**
 * Explore quotas are per person, not per server.
 *
 * The report editor charges a guild because a report belongs to one; an
 * explore conversation belongs to a user and reads the whole lake, so a guild
 * scope would mean nothing. Production question quotas and active-run
 * admission are enforced transactionally in `temporal/durable-quota.ts`.
 * Provider spending has its own durable ledger in `explore/spending`.
 *
 * This process keeps an additional fast concurrency guard. Durable tickets
 * skip its question buckets to avoid charging the same turn twice. The
 * buckets remain available to callers that do not use durable execution.
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

export class ExploreConversationBusyError extends Error {}

/**
 * A granted turn, in two phases.
 *
 * Reserving takes concurrency and quota capacity immediately, so concurrent
 * requests cannot all claim the same last question. It does not permanently
 * spend quota: `commit()` converts the hold to usage only after the request is
 * validated and the turn is actually starting. `finish()` releases an
 * uncommitted hold, so bogus conversation ids cannot drain the allowance.
 *
 * Both calls are idempotent, and `finish()` alone is the correct cleanup for
 * an early exit: nothing was spent yet, so there is nothing to refund.
 */
export type ExploreRateLimitTicket = {
  durable?: boolean;
  allowed: true;
  runId: string;
  claimConversation: (conversationId: string) => boolean;
  commit: () => void;
  finish: () => void;
};

/**
 * Resolved per call rather than frozen at module load.
 *
 * These ceilings bound question volume, so an operator has to be able to move
 * them — down during a cost surprise, or up for one environment — without a
 * rebuild. `exploreQuotaLimits()` is the typed configuration read; the
 * shipped policy is its default.
 */
const engine = createQuotaEngine<ExploreQuotaScope, ExploreRateLimitIdentity>({
  rules: () => exploreQuotaRules(exploreQuotaLimits()),
  scopeKey: (scope, identity) =>
    scope === "global" ? "global" : identity.userId,
});

const activeUserRuns = new Map<string, number>();
let activeGlobalRuns = 0;
const activeConversationRuns = new Map<
  string,
  {
    runId: string;
    released: Promise<null>;
    release: () => void;
  }
>();

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
  durable = false,
): ExploreRateLimitTicket | ExploreRateLimitRejection {
  const quota = engine.snapshots(identity, now);

  if (activeGlobalRuns >= EXPLORE_MAX_ACTIVE_RUNS) {
    return {
      allowed: false,
      quota,
      retryAfterSeconds: 30,
      reason: "Explore is busy right now. Try again shortly.",
    };
  }

  const limited = quota.find((snapshot) => snapshot.remaining === 0);
  if ((activeUserRuns.get(identity.userId) ?? 0) > 0) {
    return {
      allowed: false,
      quota,
      retryAfterSeconds: 30,
      reason: "You already have an Explore answer running.",
    };
  }
  if (!durable && limited !== undefined) {
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
  const quotaReservation = durable ? null : engine.reserve(identity, now);
  const runId = globalThis.crypto.randomUUID();
  let finished = false;
  let committed = false;
  let claimedConversationId: string | null = null;

  return {
    allowed: true,
    durable,
    runId,
    claimConversation: (conversationId) => {
      if (finished) {
        throw new Error("A finished Explore turn cannot claim a conversation.");
      }
      if (claimedConversationId !== null) {
        return claimedConversationId === conversationId;
      }
      if (activeConversationRuns.has(conversationId)) {
        return false;
      }
      const deferred = Promise.withResolvers<null>();
      activeConversationRuns.set(conversationId, {
        runId,
        released: deferred.promise,
        release: () => {
          deferred.resolve(null);
        },
      });
      claimedConversationId = conversationId;
      return true;
    },
    // Charged against `now` rather than commit time: the window a request
    // belongs to is when it arrived, and the two are milliseconds apart.
    commit: () => {
      if (committed) {
        return;
      }
      committed = true;
      quotaReservation?.commit();
    },
    finish: () => {
      if (finished) {
        return;
      }
      finished = true;
      quotaReservation?.release();
      const activeForUser = activeUserRuns.get(identity.userId) ?? 0;
      if (activeForUser <= 1) {
        activeUserRuns.delete(identity.userId);
      } else {
        activeUserRuns.set(identity.userId, activeForUser - 1);
      }
      if (claimedConversationId !== null) {
        const active = activeConversationRuns.get(claimedConversationId);
        if (active?.runId === runId) {
          activeConversationRuns.delete(claimedConversationId);
          active.release();
        }
      }
      activeGlobalRuns = Math.max(0, activeGlobalRuns - 1);
    },
  };
}

/** Wait until the adapter currently owning a conversation has finished. */
export async function waitForExploreConversation(
  conversationId: string,
): Promise<void> {
  const active = activeConversationRuns.get(conversationId);
  if (active !== undefined) {
    await active.released;
  }
}

export function resetExploreRateLimitStateForTests(): void {
  engine.reset();
  activeUserRuns.clear();
  activeGlobalRuns = 0;
  for (const active of activeConversationRuns.values()) {
    active.release();
  }
  activeConversationRuns.clear();
}

function quotaReason(snapshot: ExploreQuotaSnapshot): string {
  const subject = snapshot.scope === "user" ? "You have" : "Explore has";
  return `${subject} used ${snapshot.used.toString()} of ${snapshot.limit.toString()} questions for this ${snapshot.window}.`;
}
