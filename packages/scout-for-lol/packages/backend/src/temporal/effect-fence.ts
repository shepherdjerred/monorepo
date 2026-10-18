import { ApplicationFailure } from "@temporalio/common";
import type { ScoutGuardedEffectResult } from "@scout-for-lol/temporal/activity-contracts";
import type { ScoutDurableCommit } from "@scout-for-lol/temporal/pipeline-contracts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

/**
 * The at-most-once fence around a V2 guarded effect.
 *
 * A guarded effect is once-only because of TWO things, and neither is enough
 * alone. Its durable FACT — the evidence-bearing receipt the effect records as
 * its last write — says whether the effect already happened, and every caller
 * supplies the probe that reads it. But a read is not a fence under Temporal:
 * a start-to-close timeout fires while the original attempt is STILL RUNNING,
 * the retry reads "no fact yet", and both live attempts enter the effect. For
 * settlement and progression that is a visible double application.
 *
 * A Postgres advisory transaction lock closes it, using the same idiom
 * `withChallengeProgressionLock` already uses for exactly this shape of
 * problem. `apply()` runs INSIDE the lock-holding transaction's callback, so
 * the connection stays pinned and the lock stays held for the whole effect.
 * The fact is read under the lock, so a rival that waited for it observes
 * what the holder recorded.
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
 * The liveness probe at each write boundary closes the remaining cliff: a
 * transaction that is still open never released its xact lock, and one Prisma
 * already rolled back fails the probe. It fails CLOSED, so the fact is not
 * recorded and the next attempt re-enters under a lock it genuinely holds.
 *
 * ## What the fence hands the effect, and why
 *
 * The lock is held by THIS module's transaction, but the effect's own writes
 * go through top-level connections, so a lock that has lapsed does not stop
 * them by itself: an effect that exceeds the lock lifetime is a ZOMBIE whose
 * remaining writes race whatever rival entered after Postgres released the
 * lock. Cooperative cancellation is what closes that, and it is the same
 * AbortSignal discipline every other external wait in V2 already follows.
 *
 * `apply()` receives a {@link ScoutEffectFence}: an `AbortSignal` that is
 * aborted shortly BEFORE the lock's own timer would fire, and `assertHeld()`,
 * which refuses once the signal is aborted and otherwise proves the
 * lock-holding transaction is still open. An effect calls `assertHeld()` at
 * every durable write boundary it owns — before it enters its domain commit
 * and before it records its fact — so a write that would land after the fence
 * lapsed is refused rather than raced. The fact is the last write of all, so
 * nothing a zombie writes can make the effect look finished.
 *
 * The lead the signal has on the lock's timer is what makes a boundary check
 * near the lapse honest: a probe that answered "held" one millisecond before
 * the rollback would let a write land one millisecond after it. Aborting
 * early by {@link ScoutEffectFenceBudget.fenceAbortLeadMs} turns that race
 * into a refusal.
 *
 * ## The residual, stated plainly
 *
 * The boundaries this closes are the ones V2 owns: the entry into each
 * domain commit and the fact receipt. The v1 code an
 * effect calls BETWEEN two boundaries — settlement's ledger writes inside
 * `settleBucksWithDareTimeline`, progression's writes under
 * `withChallengeProgressionLock` — is not signal-aware, so a zombie that has
 * already entered one of those calls when its fence lapses finishes that call.
 * What bounds those writes is their own design: every ledger transition is
 * state-gated, so a rival re-applying on top of them finds nothing left to do
 * and its fact conflicts with the zombie's — visibly, as a `conflict` that
 * fails the Activity, never as a silent double application. And the zombie
 * itself cannot record a fact after the lapse, because that write goes
 * through `assertHeld()`.
 *
 * A session-level `pg_advisory_lock` would have no timer at all, but Prisma
 * offers no way to pin a connection outside a transaction, and a session lock
 * taken inside one outlives the transaction on a pooled connection this code
 * can no longer address — it would leak the lock instead of releasing it. The
 * xact lock is the only pin Prisma can actually give, which is why its
 * lifetime is sized rather than extended.
 *
 * No fencing-token column is needed: Postgres already is the shared lock
 * manager a token would substitute for, the fact receipt already records the
 * outcome the token would carry, and a token verified at the write itself
 * would only close the boundaries this signal already closes — the v1 ledger
 * writes between them are exactly as unaware of a token as of a signal.
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
 * The probe and the effect's own writes go through TOP-LEVEL connections,
 * never the lock-holding transaction's. If the fact were written in this
 * transaction, a later throw (an overrun, or the effect itself failing) would
 * roll it back while the effect's other writes stood, and the next attempt
 * would see no fact and re-apply an effect that already happened. The lock
 * provides mutual exclusion; the fact must outlive the lock-holder's outcome.
 *
 * ## Why there is no separate claim row
 *
 * This fence used to write a `ScoutEffectClaim` row beside the fact and read
 * it before the effect. Under the lock that row never answered anything the
 * fact did not: an effect whose fact stands is done, and one whose fact does
 * not is owed, whatever an earlier attempt left in a claim. The claim was a
 * second, weaker record of the same thing — every COMPLETED claim had a
 * standing fact, while a fact without a completed claim (an attempt that
 * recorded its receipt and died) needed a takeover reconcile to stop the
 * claim contradicting it. Reading the fact first, every time, is that
 * reconcile made the only path.
 */

const logger = createLogger("scout-v2-effect-fence");

const SCOUT_EFFECT_LOCK_NAMESPACE = "scout-v2-effect";

/**
 * How long the fence guarantees the lock, when a slow effect starts
 * screaming, and how early the effect is told to stop writing.
 *
 * `slowEffectWarningMs` is TELEMETRY ONLY. It logs and it does not release:
 * releasing on a timer is the defect this design removed. It is set to the
 * longest legitimate inner wait — progression's own advisory-lock budget — so
 * anything past it has already exceeded every bound the effect itself
 * respects.
 *
 * `fenceAbortLeadMs` is how far ahead of the lock's own timer the effect's
 * `AbortSignal` fires. Prisma's rollback and the signal run on the same clock
 * — both start when the transaction opens — so the lead is the window in
 * which a boundary check refuses BEFORE the lock is actually gone, rather than
 * racing the rollback. Five seconds dwarfs any single write's latency and is
 * negligible against a thirty-minute lifetime.
 *
 * Injectable so a test can shrink all three and drive the slow, lapsed and
 * zombie paths in seconds rather than half an hour; nothing in production
 * passes them.
 */
export type ScoutEffectFenceBudget = {
  readonly lockLifetimeMs: number;
  readonly slowEffectWarningMs: number;
  readonly fenceAbortLeadMs: number;
};

export const SCOUT_EFFECT_FENCE_BUDGET: ScoutEffectFenceBudget = {
  lockLifetimeMs: 1_800_000,
  slowEffectWarningMs: 120_000,
  fenceAbortLeadMs: 5000,
};

const FENCE_LOCK_MAX_WAIT_MS = 15_000;

export type GuardedEffect = {
  readonly fact: ScoutDurableCommit;
  readonly effects: number;
};

/**
 * What an effect holds while it runs: proof, on demand, that it is still
 * fenced.
 *
 * `signal` aborts once the fence can no longer be trusted, and is the value to
 * hand to any wait that accepts one. `assertHeld()` is the check an effect
 * makes at each durable write boundary it owns; it throws the non-retryable
 * `EffectFenceLost` once the signal is aborted, and otherwise proves the
 * lock-holding transaction is still open — which is the only way to observe a
 * rollback Prisma performed underneath the effect.
 */
export type ScoutEffectFence = {
  readonly signal: AbortSignal;
  readonly assertHeld: () => Promise<void>;
};

/**
 * What one guarded effect is, from the fence's point of view.
 *
 * `key` names the effect for the advisory lock. It is the same string the
 * retired claim row was keyed by, so attempts running the previous build and
 * this one during a rolling deploy still serialize on one lock.
 *
 * `apply` is handed the fence and is expected to consult it before every
 * durable write it owns, and to record its fact as its last write. An effect
 * that never calls `assertHeld()` is still mutually excluded, but its own
 * writes past a lapse are then bounded only by their state gates. See the
 * module doc for what that residual is.
 *
 * `alreadyApplied` reads the effect's durable fact, and it is supplied by the
 * caller rather than built into the fence because only the caller knows what
 * its fact looks like: settlement's receipt kind is not progression's, and
 * the fence must stay generic over both. It answers "this effect's fact
 * already stands, and here is what it says" — or `null` when there is nothing
 * recorded yet. It is required: without it the fence could not tell a
 * finished effect from an owed one.
 */
export type ScoutGuardedEffect = {
  readonly key: string;
  readonly apply: (fence: ScoutEffectFence) => Promise<GuardedEffect>;
  readonly alreadyApplied: () => Promise<GuardedEffect | null>;
};

export type ScoutEffectFenceOptions = {
  readonly database?: ExtendedPrismaClient;
  readonly budget?: ScoutEffectFenceBudget;
  readonly shared?: boolean;
};

/**
 * Run `apply` to settlement, holding the fence for exactly as long as it takes.
 *
 * The warning timer only ever LOGS. Returning early on it would unwind the
 * transaction, release the lock, and leave the effect running unfenced — the
 * one outcome this fence exists to prevent — so a slow effect is reported and
 * then waited for. What a slow effect gets instead is the fence handle, whose
 * signal tells it to stop writing once the lock is about to go.
 */
async function applyHoldingTheFence(
  apply: ScoutGuardedEffect["apply"],
  fence: ScoutEffectFence,
  key: string,
  warningMs: number,
): Promise<GuardedEffect> {
  const warning = setTimeout(() => {
    logger.error(
      `⏳ Effect ${key} has held the V2 fence for more than ${String(warningMs)}ms; the lock is still held and the effect is still being waited on, but an effect this slow is pathological`,
    );
  }, warningMs);
  try {
    return await apply(fence);
  } finally {
    clearTimeout(warning);
  }
}

function fenceLost(key: string, cause: unknown): ApplicationFailure {
  return ApplicationFailure.nonRetryable(
    `The fence for ${key} lapsed while its effect was running, so another attempt may have entered; refusing to write past it`,
    "EffectFenceLost",
    [cause],
  );
}

/**
 * Prove the fence still holds before anything is allowed to depend on it.
 *
 * Two checks, and the order matters. The signal is consulted first because it
 * fires AHEAD of the lock's timer: a probe alone could answer "held" an
 * instant before the rollback and let the write that follows land after it.
 * Then the transaction is probed, because an advisory xact lock is held from
 * acquisition until its transaction ends, so a transaction that is still open
 * has necessarily held the lock without interruption — and if Prisma already
 * rolled it back on its own timer, or the connection died, the probe throws.
 */
async function assertFenceStillHeld(
  tx: Db,
  key: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw fenceLost(key, signal.reason);
  }
  try {
    await tx.$queryRaw`SELECT 1`;
  } catch (error) {
    throw fenceLost(key, error);
  }
}

/**
 * Run one guarded effect behind the fence, and report the guard and the fact
 * apart.
 *
 * Under the lock the caller's fact probe is read FIRST. A standing fact means
 * an earlier attempt — one that finished, or one that recorded its fact and
 * died before returning — already applied the effect, so this run reports
 * `already-applied` on the guard and hands back the standing fact rather than
 * re-running a state-gated effect that would find nothing left to do, record
 * empty evidence and conflict with the receipt that stands. Under the lock the
 * read is race-free: a live rival would still hold the lock, so the probe
 * answers for every attempt that can no longer write.
 *
 * A `conflict` fact FAILS the Activity. The fact is the durable receipt this
 * effect is attested by, and `conflict` means a receipt for this identity
 * already exists carrying different evidence — two producers disagreeing
 * about what happened. Reporting it as done would let the Workflow write its
 * stage receipt, advance the cursor, and bury the disagreement permanently;
 * failing leaves the run visibly failed for an operator, and the receipt
 * repository's `conflict` count raises `ScoutDurableReceiptConflicts`. A
 * drift conflict is a broken contract, and a broken contract fails loudly.
 */
export async function runGuardedEffect(
  args: ScoutGuardedEffect,
  options: ScoutEffectFenceOptions = {},
): Promise<ScoutGuardedEffectResult> {
  const budget = options.budget ?? SCOUT_EFFECT_FENCE_BUDGET;
  return await withScoutEffectFence(
    args.key,
    async (fence) => await applyUnderFence(args, fence, budget),
    options,
  );
}

/** Shared mutual exclusion for external effects with their own PG progress ledger. */
export async function withScoutEffectFence<T>(
  key: string,
  apply: (fence: ScoutEffectFence) => Promise<T>,
  options: ScoutEffectFenceOptions = {},
): Promise<T> {
  const database = options.database ?? prisma;
  const budget = options.budget ?? SCOUT_EFFECT_FENCE_BUDGET;
  // Armed BEFORE the transaction opens, on the same clock Prisma's own timer
  // starts on, so the lead is measured against the lock's real lifetime
  // rather than against whenever the lock happened to be acquired.
  const controller = new AbortController();
  const abortAhead = setTimeout(
    () => {
      controller.abort(
        new Error(
          `The fence for ${key} is ${String(budget.fenceAbortLeadMs)}ms from lapsing`,
        ),
      );
    },
    Math.max(0, budget.lockLifetimeMs - budget.fenceAbortLeadMs),
  );
  try {
    return await database.$transaction(
      async (tx) => {
        if (options.shared === true) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${SCOUT_EFFECT_LOCK_NAMESPACE}), hashtext(${key}))`;
        } else {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SCOUT_EFFECT_LOCK_NAMESPACE}), hashtext(${key}))`;
        }
        const fence: ScoutEffectFence = {
          signal: controller.signal,
          assertHeld: async () => {
            await assertFenceStillHeld(tx, key, controller.signal);
          },
        };
        return await apply(fence);
      },
      { maxWait: FENCE_LOCK_MAX_WAIT_MS, timeout: budget.lockLifetimeMs },
    );
  } finally {
    clearTimeout(abortAhead);
  }
}

async function applyUnderFence(
  args: ScoutGuardedEffect,
  fence: ScoutEffectFence,
  budget: ScoutEffectFenceBudget,
): Promise<ScoutGuardedEffectResult> {
  const standing = await args.alreadyApplied();
  if (standing !== null) {
    return {
      guard: { outcome: "already-applied" },
      fact: standing.fact,
      effects: standing.effects,
    };
  }

  const applied = await applyHoldingTheFence(
    args.apply,
    fence,
    args.key,
    budget.slowEffectWarningMs,
  );
  if (applied.fact.outcome === "conflict") {
    throw ApplicationFailure.nonRetryable(
      `Effect ${args.key} applied but its durable fact conflicts (${applied.fact.reason}); refusing to report it as done so the drift stays visible`,
      "DurableCommitConflict",
    );
  }
  return {
    guard: { outcome: "applied" },
    fact: applied.fact,
    effects: applied.effects,
  };
}
