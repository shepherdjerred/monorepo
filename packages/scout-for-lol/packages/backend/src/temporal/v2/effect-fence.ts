import { ApplicationFailure } from "@temporalio/common";
import type { ScoutGuardedEffectV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutDurableCommitV2 } from "@scout-for-lol/temporal/contracts-v2";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  getScoutEffectClaim,
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
 * problem. `apply()` runs INSIDE the lock-holding transaction's callback, so
 * the connection stays pinned and the lock stays held for the whole effect.
 *
 * ## Why the lock's lifetime has to be proved, not assumed
 *
 * An advisory xact lock lives exactly as long as its transaction, and a Prisma
 * interactive transaction ends on ITS OWN timer as well as on its callback.
 * When that timer fires Prisma rolls the transaction back — releasing the
 * lock — while the JavaScript callback keeps running, because a promise cannot
 * be cancelled. Temporal's start-to-close does not help: it stops the server
 * waiting for the Activity, it does not stop the code. So "the callback is
 * still running" does NOT by itself mean "the lock is still held", and a
 * retry that acquired the released lock would double-apply.
 *
 * Two mechanisms close that, and they do different jobs:
 *
 * - {@link ScoutEffectFenceBudget.effectDeadlineMs} bounds `apply()` strictly
 *   INSIDE the lock's lifetime. If the effect overruns, the fence stops
 *   waiting while it still provably holds the lock, so the bookkeeping that
 *   follows happens under the fence rather than after it.
 * - The liveness probe before completion proves the lock was held for the
 *   whole effect: a transaction that is still open never released its xact
 *   lock, and a transaction Prisma already rolled back fails the probe.
 *
 * Both fail CLOSED. Neither completes the claim, so the next attempt re-enters
 * under a lock it genuinely holds rather than inheriting a completion nobody
 * can vouch for.
 *
 * A session-level `pg_advisory_lock` would have no timer at all, but Prisma
 * offers no way to pin a connection outside a transaction, and a session lock
 * taken inside one outlives the transaction on a pooled connection this code
 * can no longer address — it would leak the lock instead of releasing it. The
 * xact lock is the only pin Prisma can actually give, which is why its
 * lifetime is proved rather than extended.
 *
 * No fencing-token column is needed for any of this: Postgres already is the
 * shared lock manager a token would substitute for, and the claim row already
 * records the outcome the token would carry.
 *
 * ## The transaction holds the lock and nothing else
 *
 * Every claim read and write below goes through the TOP-LEVEL client, never
 * the transaction's. Two reasons, and they point the same way.
 * `effect-claims.ts` explains the first: `claimScoutEffect` is an insert that
 * expects to fail and then reads the existing row back, and a constraint
 * violation aborts the surrounding transaction, so that read-back cannot run
 * inside one. The second is durability — if the claim were written in this
 * transaction, a later throw (a drift conflict, an overrun, or the effect
 * itself failing) would roll the claim back and the next attempt would see no
 * claim at all and re-apply an effect that already happened. The lock provides
 * mutual exclusion; the claim must outlive the lock-holder's outcome.
 */

const SCOUT_V2_EFFECT_LOCK_NAMESPACE = "scout-v2-effect";

/**
 * How long the fence guarantees the lock, and how long the effect may take.
 *
 * The lock lifetime is deliberately far above any plausible effect: settlement
 * is bounded by its Riot reads and a handful of transactions, and progression
 * nests `withChallengeProgressionLock`, whose own budget is two minutes. The
 * deadline sits well below the lifetime so that an overrun is detected — and
 * recorded — with the lock still in hand.
 *
 * Injectable so a test can shrink both and drive the expiry paths in seconds
 * rather than minutes; nothing in production passes them.
 */
export type ScoutEffectFenceBudget = {
  readonly lockLifetimeMs: number;
  readonly effectDeadlineMs: number;
};

export const SCOUT_V2_EFFECT_FENCE_BUDGET: ScoutEffectFenceBudget = {
  lockLifetimeMs: 900_000,
  effectDeadlineMs: 600_000,
};

const FENCE_LOCK_MAX_WAIT_MS = 15_000;

export type GuardedEffect = {
  readonly fact: ScoutDurableCommitV2;
  readonly effects: number;
};

/**
 * What one guarded effect is, from the fence's point of view.
 *
 * `alreadyApplied` is the TAKEOVER reconcile, and it is supplied by the caller
 * rather than built into the fence because only the caller knows what its
 * durable fact looks like: settlement's receipt kind is not progression's, and
 * the fence must stay generic over both. It answers "this effect's fact
 * already stands, and here is what it says" — or `null` when there is nothing
 * recorded yet.
 */
export type ScoutGuardedEffectV2 = {
  readonly key: string;
  readonly kind: string;
  readonly apply: () => Promise<GuardedEffect>;
  readonly alreadyApplied?: () => Promise<GuardedEffect | null>;
};

export type ScoutEffectFenceOptions = {
  readonly database?: ExtendedPrismaClient;
  readonly budget?: ScoutEffectFenceBudget;
};

/**
 * Record that an attempt did not finish, WITHOUT ever downgrading a completed
 * claim.
 *
 * `completeScoutEffect` can commit and then fail to acknowledge — a dropped
 * connection between the write and its response. An unguarded failure write
 * would then turn a genuinely COMPLETED claim into `AMBIGUOUS_OR_FAILED`, and
 * the next attempt would re-execute an effect that already ran. For a
 * state-gated effect that re-execution finds nothing left to do, produces
 * empty evidence, and conflicts with the first run's receipt — wedging the
 * match on a drift that never happened.
 *
 * The guard is on the STATE rather than on the caller knowing which failure it
 * had, because the caller cannot know: an acknowledgement that never arrived
 * is indistinguishable from a write that never landed. Letting the row itself
 * decide is the only answer that is right in both cases.
 */
async function recordFenceFailure(
  key: string,
  error: unknown,
  database: ExtendedPrismaClient,
): Promise<void> {
  await database.scoutEffectClaim.updateMany({
    where: { key, state: { not: "COMPLETED" } },
    data: {
      state: "AMBIGUOUS_OR_FAILED",
      lastError: error instanceof Error ? error.message : String(error),
    },
  });
}

/** Run `apply`, refusing to outlast the lock that is fencing it. */
async function applyWithinDeadline(
  apply: () => Promise<GuardedEffect>,
  key: string,
  deadlineMs: number,
): Promise<GuardedEffect> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        ApplicationFailure.nonRetryable(
          `Effect ${key} exceeded its ${String(deadlineMs)}ms fence deadline; abandoning it while the lock is still held rather than completing a claim the fence cannot vouch for`,
          "EffectFenceDeadlineExceeded",
        ),
      );
    }, deadlineMs);
  });
  try {
    return await Promise.race([apply(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Prove the fence still holds before anything is allowed to depend on it.
 *
 * An advisory xact lock is held from acquisition until its transaction ends,
 * so a transaction that is still open has necessarily held the lock without
 * interruption. This query is the cheapest way to ask that question: if Prisma
 * already rolled the transaction back on its own timer, it throws.
 */
async function assertFenceStillHeld(tx: Db, key: string): Promise<void> {
  try {
    await tx.$queryRaw`SELECT 1`;
  } catch (error) {
    throw ApplicationFailure.nonRetryable(
      `The fence for ${key} lapsed while its effect was running, so another attempt may have entered; refusing to complete the claim`,
      "EffectFenceLost",
      [error],
    );
  }
}

/**
 * Run one guarded effect behind the fence, and report the guard and the fact
 * apart.
 *
 * The claim is READ before it is made. `claimScoutEffect` answers what the
 * caller may do, which collapses a first claim and a take-over of an
 * unfinished one into `execute`; the prior read is what separates `applied`
 * from `already-applied` on the guard. Under the lock that read is also
 * race-free, so the guard outcome is a fact rather than a best effort, and a
 * `CLAIMED` row means the holder cannot still be running — a live holder would
 * still own the lock.
 *
 * A takeover — a claim row that exists but is not COMPLETED — first asks the
 * caller's `alreadyApplied` probe whether the durable fact already stands, and
 * completes the claim from that standing evidence rather than re-running the
 * effect. See the call site for why re-running is not merely wasteful.
 *
 * A `conflict` fact FAILS the Activity and deliberately does not complete the
 * claim. The fact is the durable receipt this effect is attested by, and
 * `conflict` means a receipt for this identity already exists carrying
 * different evidence — two producers disagreeing about what happened.
 * Completing the claim there would let the Workflow write its stage receipt,
 * advance the cursor, and bury the disagreement permanently; failing leaves
 * the claim unfinished for reconciliation and the run visibly failed for an
 * operator. A drift conflict is a broken contract, and a broken contract fails
 * loudly.
 */
export async function runGuardedEffectV2(
  args: ScoutGuardedEffectV2,
  options: ScoutEffectFenceOptions = {},
): Promise<ScoutGuardedEffectV2Result> {
  const database = options.database ?? prisma;
  const budget = options.budget ?? SCOUT_V2_EFFECT_FENCE_BUDGET;
  return await database.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${SCOUT_V2_EFFECT_LOCK_NAMESPACE}),
          hashtext(${args.key})
        )
      `;
      return await applyUnderFence(args, tx, database, budget);
    },
    { maxWait: FENCE_LOCK_MAX_WAIT_MS, timeout: budget.lockLifetimeMs },
  );
}

async function applyUnderFence(
  args: ScoutGuardedEffectV2,
  tx: Db,
  database: ExtendedPrismaClient,
  budget: ScoutEffectFenceBudget,
): Promise<ScoutGuardedEffectV2Result> {
  const prior = await getScoutEffectClaim(args.key, database);
  const guard: ScoutDurableCommitV2 =
    prior === null ? { outcome: "applied" } : { outcome: "already-applied" };
  const skipped = {
    guard,
    fact: { outcome: "already-applied" } as const,
    effects: 0,
  };
  if (prior?.state === "COMPLETED") {
    return skipped;
  }

  const claim = await claimScoutEffect(
    { key: args.key, kind: args.kind },
    database,
  );
  if (claim === "completed") {
    // Unreachable while the fence holds — the read above already saw every
    // COMPLETED row — but the claim is still the authority on its own state,
    // so its answer wins over the read's rather than being asserted away.
    return skipped;
  }

  // A TAKEOVER, not a first claim: some earlier attempt got far enough to
  // create this row. It may also have got far enough to commit its durable
  // fact and die before completing the claim, and re-executing on top of that
  // is how two correct rules build a permanent wedge — the state-gated effect
  // finds nothing left to do, records empty evidence, and conflicts with the
  // standing receipt, which the conflict rule then turns into a non-retryable
  // failure forever. Reconciling from the fact that already stands is what
  // makes the takeover finish the dead attempt instead of fighting it.
  if (prior !== null && args.alreadyApplied !== undefined) {
    const standing = await args.alreadyApplied();
    if (standing !== null) {
      await completeScoutEffect(args.key, database);
      return { guard, fact: standing.fact, effects: standing.effects };
    }
  }

  let applied: GuardedEffect;
  try {
    applied = await applyWithinDeadline(
      args.apply,
      args.key,
      budget.effectDeadlineMs,
    );
  } catch (error) {
    await recordFenceFailure(args.key, error, database);
    throw error;
  }

  if (applied.fact.outcome === "conflict") {
    const conflict = ApplicationFailure.nonRetryable(
      `Effect ${args.key} applied but its durable fact conflicts (${applied.fact.reason}); refusing to complete the claim so the drift stays visible`,
      "DurableCommitConflict",
    );
    await recordFenceFailure(args.key, conflict, database);
    throw conflict;
  }

  await assertFenceStillHeld(tx, args.key);

  try {
    await completeScoutEffect(args.key, database);
  } catch (error) {
    // The completion may have COMMITTED and lost only its acknowledgement, so
    // this must not assume the claim is unfinished; `recordFenceFailure` lets
    // the row decide.
    await recordFenceFailure(args.key, error, database);
    throw error;
  }
  return { guard, fact: applied.fact, effects: applied.effects };
}
