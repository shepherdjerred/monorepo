import { ApplicationFailure } from "@temporalio/common";
import type { ScoutGuardedEffectV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutDurableCommitV2 } from "@scout-for-lol/temporal/contracts-v2";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  getScoutEffectClaim,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";

/**
 * The at-most-once fence around a V2 guarded effect.
 *
 * `ScoutEffectClaim` alone is not a fence, and under Temporal that gap is
 * reachable. `claimScoutEffect` answers `execute` for a row already in
 * `CLAIMED` — v1's `ambiguous_retry`, which is safe there because one
 * process-local poller runs one attempt at a time, so a CLAIMED row can only
 * belong to a dead pass. A Temporal Activity has no such serialization: a
 * start-to-close timeout fires while the original attempt is STILL RUNNING,
 * the retry reads the same CLAIMED row, and both live attempts enter the
 * effect. For settlement and progression that is a visible double application.
 *
 * A Postgres advisory transaction lock closes it, using the same idiom
 * `withChallengeProgressionLock` already uses for exactly this shape of
 * problem. The lock is held for the whole effect, so the second attempt waits
 * rather than racing; when it gets in it re-reads the claim and finds either
 * `COMPLETED` (the first attempt finished — skip) or a claim whose holder
 * cannot still be running, because a live holder would still own the lock.
 * "CLAIMED under the lock" therefore means "genuinely dead", which is what
 * makes taking it over safe rather than a guess.
 *
 * ## The transaction holds the lock and nothing else
 *
 * Every claim read and write below goes through the TOP-LEVEL client, never
 * the transaction's. Two reasons, and they point the same way. `effect-claims.ts`
 * explains the first: `claimScoutEffect` is an insert that expects to fail and
 * then reads the existing row back, and a constraint violation aborts the
 * surrounding transaction, so that read-back cannot run inside one. The second
 * is durability — if the claim were written in this transaction, a later throw
 * (a drift conflict, or the effect itself failing) would roll the claim back
 * and the next attempt would see no claim at all and re-apply an effect that
 * already happened. The lock provides mutual exclusion; the claim must outlive
 * the lock-holder's outcome.
 *
 * This is also why no schema change is needed. A fencing token would be the
 * answer if the fence had to survive across processes without a shared lock
 * manager; Postgres already is that shared lock manager, and the claim row
 * already records the outcome the token would carry.
 */

const SCOUT_V2_EFFECT_LOCK_NAMESPACE = "scout-v2-effect";

/**
 * The same budget `withChallengeProgressionLock` spends, and for the same
 * reason: progression runs inside that lock, so a shorter outer budget would
 * time this transaction out while the inner one is still legitimately working.
 * The Activity's own 90-second start-to-close is the real bound in practice.
 */
const EFFECT_LOCK_MAX_WAIT_MS = 15_000;
const EFFECT_LOCK_TIMEOUT_MS = 120_000;

export type GuardedEffect = {
  readonly fact: ScoutDurableCommitV2;
  readonly effects: number;
};

/**
 * Run one guarded effect behind the fence, and report the guard and the fact
 * apart.
 *
 * The claim is READ before it is made. `claimScoutEffect` answers what the
 * caller may do, which collapses a first claim and a take-over of an
 * unfinished one into `execute`; the prior read is what separates `applied`
 * from `already-applied` on the guard. Under the lock that read is also
 * race-free, so the guard outcome is a fact rather than a best effort.
 *
 * A `conflict` fact FAILS the Activity and deliberately does not complete the
 * claim. The fact is the durable receipt this effect is attested by, and
 * `conflict` means a receipt for this identity already exists carrying
 * different evidence — two producers disagreeing about what happened.
 * Completing the claim there would let the Workflow write its stage receipt,
 * advance the cursor, and bury the disagreement permanently; failing leaves
 * the claim unfinished for reconciliation and the run visibly failed for an
 * operator. A drift conflict is a broken contract, and a broken contract
 * fails loudly.
 *
 * `completeScoutEffect` runs only after a clean fact commits, so a crash
 * between them leaves the claim unfinished and the next attempt re-applies.
 * Both V2 effects are state-gated in their own tables — settlement reads
 * pending bets and unresolved Dares, progression re-prepares from current
 * runs — so the repeat finds nothing left to do.
 */
export async function runGuardedEffectV2(
  args: {
    key: string;
    kind: string;
    apply: () => Promise<GuardedEffect>;
  },
  database: ExtendedPrismaClient = prisma,
): Promise<ScoutGuardedEffectV2Result> {
  return await database.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${SCOUT_V2_EFFECT_LOCK_NAMESPACE}),
          hashtext(${args.key})
        )
      `;
      return await applyUnderFence(args, database);
    },
    { maxWait: EFFECT_LOCK_MAX_WAIT_MS, timeout: EFFECT_LOCK_TIMEOUT_MS },
  );
}

async function applyUnderFence(
  args: {
    key: string;
    kind: string;
    apply: () => Promise<GuardedEffect>;
  },
  database: ExtendedPrismaClient,
): Promise<ScoutGuardedEffectV2Result> {
  const prior = await getScoutEffectClaim(args.key, database);
  const guard: ScoutDurableCommitV2 =
    prior === null ? { outcome: "applied" } : { outcome: "already-applied" };
  if (prior?.state === "COMPLETED") {
    return { guard, fact: { outcome: "already-applied" }, effects: 0 };
  }

  const claim = await claimScoutEffect(
    { key: args.key, kind: args.kind },
    database,
  );
  if (claim === "completed") {
    // Unreachable while the fence holds — the read above already saw every
    // COMPLETED row — but the claim is still the authority on its own state,
    // so its answer wins over the read's rather than being asserted away.
    return { guard, fact: { outcome: "already-applied" }, effects: 0 };
  }

  try {
    const applied = await args.apply();
    if (applied.fact.outcome === "conflict") {
      throw ApplicationFailure.nonRetryable(
        `Effect ${args.key} applied but its durable fact conflicts (${applied.fact.reason}); refusing to complete the claim so the drift stays visible`,
        "DurableCommitConflict",
      );
    }
    await completeScoutEffect(args.key, database);
    return { guard, fact: applied.fact, effects: applied.effects };
  } catch (error) {
    await recordScoutEffectFailure(args.key, error, database);
    throw error;
  }
}
