import { ApplicationFailure } from "@temporalio/common";
import type { ScoutGuardedEffectV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutDurableCommitV2 } from "@scout-for-lol/temporal/contracts-v2";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
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
 * So the fence HOLDS UNTIL THE EFFECT SETTLES. `apply()` is awaited to
 * completion inside the transaction; there is deliberately no deadline that
 * stops waiting, because stopping waiting is precisely what opens the window.
 * A race that returned on a timer would unwind the transaction and release the
 * lock while `apply()` carried on writing through top-level connections — the
 * abandoned effect and its replacement would then both be live, which is the
 * defect the lock exists to prevent. A promise cannot be cancelled, so the
 * only honest options are to wait for it or to leave it unfenced, and waiting
 * is the one that is safe.
 *
 * The lock's lifetime is therefore sized to outlast any effect that is still
 * running rather than to cut one off:
 * {@link ScoutEffectFenceBudget.lockLifetimeMs} is 30 minutes, twenty times
 * the Activity's own 90-second start-to-close and fifteen times the longest
 * legitimate inner wait (progression nests `withChallengeProgressionLock`,
 * whose budget is two minutes). An effect anywhere near that bound is
 * pathological, which is what {@link ScoutEffectFenceBudget.slowEffectWarningMs}
 * exists to say out loud — it LOGS and never releases.
 *
 * The liveness probe before completion closes the remaining cliff: a
 * transaction that is still open never released its xact lock, and one Prisma
 * already rolled back fails the probe. It fails CLOSED, so the claim is not
 * completed and the next attempt re-enters under a lock it genuinely holds.
 *
 * ## The residual, stated plainly
 *
 * One window remains and is accepted at this depth: an effect that exceeds the
 * 30-minute lock lifetime. Postgres then kills the fence's transaction, the
 * probe fails closed so nothing is completed on its behalf, and a rival that
 * enters afterwards reconciles through the takeover `alreadyApplied` probe —
 * which reads the durable fact the zombie committed rather than re-applying
 * on top of it. What is NOT closed is the zombie's own remaining writes racing
 * that rival. Closing it completely needs cooperative cancellation inside the
 * effects themselves or a fencing-token column, both of which are design
 * changes rather than fixes.
 *
 * A session-level `pg_advisory_lock` would have no timer at all, but Prisma
 * offers no way to pin a connection outside a transaction, and a session lock
 * taken inside one outlives the transaction on a pooled connection this code
 * can no longer address — it would leak the lock instead of releasing it. The
 * xact lock is the only pin Prisma can actually give, which is why its
 * lifetime is sized rather than extended.
 *
 * No fencing-token column is needed for the rest: Postgres already is the
 * shared lock manager a token would substitute for, and the claim row already
 * records the outcome the token would carry.
 *
 * ## Connection pool
 *
 * Holding to settlement means a slow effect pins its pooled connection for its
 * TRUE duration, not for a capped one, while the effect's own queries take
 * other connections. At most four realtime Activities run concurrently, so the
 * ceiling is four pinned connections plus their effects' working set — the
 * same shape as `withChallengeProgressionLock`, which is proven in production,
 * but worth a look at pool saturation once V2 actually runs matches on beta.
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

const logger = createLogger("scout-v2-effect-fence");

const SCOUT_V2_EFFECT_LOCK_NAMESPACE = "scout-v2-effect";

/**
 * How long the fence guarantees the lock, and when a slow effect starts
 * screaming.
 *
 * `slowEffectWarningMs` is TELEMETRY ONLY. It logs and it does not release:
 * releasing on a timer is the defect this design removed. It is set to the
 * longest legitimate inner wait — progression's own advisory-lock budget — so
 * anything past it has already exceeded every bound the effect itself
 * respects.
 *
 * Injectable so a test can shrink both and drive the slow and expired paths in
 * seconds rather than half an hour; nothing in production passes them.
 */
export type ScoutEffectFenceBudget = {
  readonly lockLifetimeMs: number;
  readonly slowEffectWarningMs: number;
};

export const SCOUT_V2_EFFECT_FENCE_BUDGET: ScoutEffectFenceBudget = {
  lockLifetimeMs: 1_800_000,
  slowEffectWarningMs: 120_000,
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

/**
 * Run `apply` to settlement, holding the fence for exactly as long as it takes.
 *
 * The timer only ever LOGS. Returning early on it would unwind the
 * transaction, release the lock, and leave the effect running unfenced — the
 * one outcome this fence exists to prevent — so a slow effect is reported and
 * then waited for.
 */
async function applyHoldingTheFence(
  apply: () => Promise<GuardedEffect>,
  key: string,
  warningMs: number,
): Promise<GuardedEffect> {
  const warning = setTimeout(() => {
    logger.error(
      `⏳ Effect ${key} has held the V2 fence for more than ${String(warningMs)}ms; the lock is still held and the effect is still being waited on, but an effect this slow is pathological`,
    );
  }, warningMs);
  try {
    return await apply();
  } finally {
    clearTimeout(warning);
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
    applied = await applyHoldingTheFence(
      args.apply,
      args.key,
      budget.slowEffectWarningMs,
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
