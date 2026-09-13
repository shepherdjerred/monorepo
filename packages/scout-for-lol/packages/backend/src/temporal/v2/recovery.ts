import { ApplicationFailure } from "@temporalio/common";
import type {
  RecoveryBatchId,
  RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type {
  RecoveryBatch,
  RecoveryBatchState,
  RecoveryCounts,
  RecoveryScanCursor,
} from "@scout-for-lol/domain/recovery/batch.ts";
import {
  abandonBatch,
  beginDigest,
  beginProcessing,
  beginScan,
  completeBatch,
  recordProcessingProgress,
  type RecoveryTransitionResult,
} from "@scout-for-lol/domain/recovery/batch-transitions.ts";
import {
  ScoutRecoveryBatchStateV2ResultSchema,
  ScoutRecoveryProcessV2ResultSchema,
  ScoutRecoveryScanV2ResultSchema,
  ScoutRecoveryTransitionV2ResultSchema,
  type ScoutRecoveryBatchStateV2Result,
  type ScoutRecoveryCloseV2Input,
  type ScoutRecoveryProcessV2Result,
  type ScoutRecoveryScanV2Result,
  type ScoutRecoveryTransitionV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import {
  SCOUT_V2_PAGE_MAX,
  type ScoutDurableCommitV2,
  type ScoutRecoveryBatchRefV2,
} from "@scout-for-lol/temporal/contracts-v2";
import { prisma } from "#src/database/index.ts";
import {
  getObservation,
  observeMatch,
} from "#src/database/durable/observation-repository.ts";
import {
  advanceRecoveryCursor,
  getRecoveryBatch,
  recoveryCommitResult,
  transitionRecoveryBatch,
} from "#src/database/durable/recovery-repository.ts";
import {
  countRecoverableMatches,
  listArchivedMatchPage,
  listObservedMatches,
  listRecoverableMatches,
  recoveryScanPosition,
  recoveryScanToken,
} from "#src/database/durable/recovery-scan.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";
import {
  isoInstantFromEpochMs,
  platformRouteOf,
  toIsoInstant,
} from "#src/durable/match/match-identity.ts";
import { rawArchiveReceiptKind } from "#src/report-lake/durable-receipts.ts";
import { readArchivedMatchArtifactV2 } from "#src/temporal/v2/match-archive.ts";
import { durableCommitV2 } from "#src/temporal/v2/match-commits.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";

/**
 * The V2 recovery batch: replaying the gap a crash leaves behind.
 *
 * A crash between the object store and the durable tables leaves a match whose
 * raw payload IS captured — a `raw-archive-match` receipt attests to the exact
 * bytes — and which nothing records Scout as having seen. The live pipeline
 * cannot find those matches again: post-match discovery works forward from each
 * tracked account's cursor, and the crash left the cursor wherever it stood.
 * Only the receipts remember.
 *
 * What a batch commits is an `ARCHIVE_ONLY` observation, and the policy is the
 * whole point of the design. It captures the FACT that the match exists and
 * which bytes are canonical for it, and runs no downstream effect: settlement,
 * progression and notification stay the live pipeline's job, and a recovery run
 * replaying a week-old outage must never announce a week-old game. Promotion to
 * `FULL` has its own transition and its own caller; nothing here reaches for
 * it, and `ARCHIVE_ONLY` promotes at most once — so the live pipeline promoting
 * a match when it later processes it for real is the only promotion there is.
 *
 * ## The boundary: durable gaps, not fetch gaps
 *
 * This repairs matches the durable tables already know about and lost track of.
 * It is NOT outage backfill. A match Riot was never polled for during a
 * downtime leaves no receipt, no observation and no row of any kind, so nothing
 * here could find it: the scan is an anti-join over receipts, and a match with
 * no receipt is invisible to it by construction. Those FETCH gaps stay with v1
 * polling's recovery path and its `recoveryStartAt` windows until a later wave
 * moves them. A reader who takes "recovery batch" to mean both would believe an
 * outage is covered when half of it is not.
 *
 * Each Activity drives exactly one edge of the pure machine in
 * `@scout-for-lol/domain/recovery/batch-transitions.ts`, and the machine's own
 * refusal is what a caller gets back when the batch is not where it thought.
 * That matters more here than anywhere else in the V2 core: a recovery batch is
 * driven by a long-lived Workflow that Continue-As-News through its own pages,
 * and the durable row — not the Workflow's memory — is where it left off.
 */

/**
 * How much of the archive range one scan page covers.
 *
 * The scan does no external work at all: two bounded database reads per page
 * and a cursor advance. So the page is as large as the V2 payload bound allows,
 * which keeps the number of cursor advances — the only durable writes the scan
 * makes — proportionate to the range rather than to a page size chosen out of
 * caution.
 */
const RECOVERY_SCAN_PAGE_SIZE = SCOUT_V2_PAGE_MAX;

/**
 * How many pages one batch may scan before it must stop.
 *
 * `RecoveryScanCursor` carries the budget precisely so an unbounded upstream
 * cannot pin a batch forever, and at this page size the budget bounds one
 * batch's survey at 10,000 archived matches — comfortably more than any outage
 * Scout has had, and far short of a batch that would scan the whole history of
 * the receipt table. A range larger than this is not one batch's work, and
 * stopping at the budget so an operator can create a second batch is a better
 * answer than a batch that never reaches its processing phase.
 */
const RECOVERY_SCAN_PAGE_BUDGET = 50;

/**
 * How many matches one processing page recovers.
 *
 * Deliberately tiny, because every item costs a Riot read. An observation needs
 * the game's creation instant, which only the authoritative MatchV5 payload
 * carries, so `resolveScoutV2MatchContext` fetches the match for each item
 * exactly as `commitMatchObservationV2` does. That budget is shared with the
 * live pipeline, and a recovery batch replaying an outage is by definition
 * running at the worst possible moment to spend it: a large page would push a
 * backlog of old matches in front of the games users are waiting on, and would
 * risk the Activity's start-to-close timeout on top of it. Ten items per page
 * lets the Workflow heartbeat between pages and leaves the rate limit to the
 * matches that matter.
 */
const RECOVERY_PROCESS_PAGE_SIZE = 10;

/**
 * What a call answers when it had nothing to write.
 *
 * A page whose work is already done makes no durable change — the cursor stands
 * where the previous page left it, the tally is already what this call would
 * record — and `already-applied` is the contract's word for exactly that. It is
 * the honest answer rather than a placeholder: the alternative shapes all claim
 * something happened.
 */
const NOTHING_COMMITTED: ScoutDurableCommitV2 = durableCommitV2({
  outcome: "already-applied",
});

/** A batch with no tally, for the states whose row keeps no count columns. */
const NO_COUNTS: RecoveryCounts = {
  discovered: 0,
  succeeded: 0,
  suppressed: 0,
  failed: 0,
};

/**
 * The stored batch, or a failure an operator has to look at.
 *
 * Every Activity below except the read is driven by a Workflow that was started
 * FOR a batch, so a missing row is not a race to retry through — it is a
 * Workflow running against an id nothing ever created, and no amount of waiting
 * will produce one. The repository throws a plain error on the same condition
 * mid-transition; catching it here first is what turns it into a Temporal
 * failure that fails fast and names itself.
 */
async function requireRecoveryBatch(
  recoveryBatchId: RecoveryBatchId,
): Promise<RecoveryBatch> {
  const record = await getRecoveryBatch(prisma, { recoveryBatchId });
  if (record === null) {
    throw ApplicationFailure.nonRetryable(
      `Recovery batch ${recoveryBatchId} does not exist, so there is nothing to drive`,
      "MissingDomainRecord",
    );
  }
  return record.batch;
}

/**
 * The batch's state as the row holds it now.
 *
 * Read back after every transition rather than taken from the transition's own
 * `next`, because the cases a caller most needs the state for are the ones that
 * have no `next` at all: an `already-applied` retry and a lost guard race both
 * answer without a batch, and the row is the only place the truth is.
 */
async function recoveryBatchState(
  recoveryBatchId: RecoveryBatchId,
): Promise<RecoveryBatchState> {
  const batch = await requireRecoveryBatch(recoveryBatchId);
  return batch.state;
}

/** One guarded transition, answered in the V2 commit vocabulary. */
async function commitRecoveryTransition(
  recoveryBatchId: RecoveryBatchId,
  transition: (batch: RecoveryBatch) => RecoveryTransitionResult,
): Promise<ScoutDurableCommitV2> {
  return durableCommitV2(
    recoveryCommitResult(
      await transitionRecoveryBatch(prisma, { recoveryBatchId, transition }),
    ),
  );
}

/**
 * The single commit a paged result may carry, chosen between the transition
 * that opened the batch's phase and the one the page itself performed.
 *
 * Both are real writes and the contract has room for one. The page's own write
 * wins whenever it changed something, because that is the news. When it answers
 * `already-applied` the page added nothing, and then the opening transition —
 * which may have just moved the batch into this phase — is what actually
 * happened on this call.
 */
function pageCommit(
  opened: ScoutDurableCommitV2,
  page: ScoutDurableCommitV2,
): ScoutDurableCommitV2 {
  return page.outcome === "already-applied" ? opened : page;
}

/**
 * The resume point for one batch, straight off the row.
 *
 * `absent` is a legitimate answer here and only here: this is what a Workflow
 * calls before it knows whether its batch was ever created, and an id with no
 * row is the answer to that question rather than a failure. The counts are not
 * a field of the contract — see `ScoutRecoveryBatchStateV2ResultSchema` — so
 * `state` carries the tally exactly while the row still holds one.
 */
export async function readRecoveryBatchV2(
  input: ScoutRecoveryBatchRefV2,
): Promise<ScoutRecoveryBatchStateV2Result> {
  const record = await getRecoveryBatch(prisma, {
    recoveryBatchId: input.recoveryBatchId,
  });
  return ScoutRecoveryBatchStateV2ResultSchema.parse(
    record === null
      ? { kind: "absent" }
      : {
          kind: "present",
          policy: record.batch.policy,
          state: record.batch.state,
        },
  );
}

/**
 * A batch positioned to scan, or the machine's reason it cannot be.
 *
 * `beginScan` is the state guard as well as the transition. It applies on a
 * `planned` batch, and from every state past the scan it answers with the
 * machine's own refusal — `terminal-state` for a closed batch,
 * `invalid-source-state` for one already processing — so this Activity never
 * has to invent a reason for a page it will not serve. A batch already
 * `scanning` skips it entirely, because `beginScan` recognises only a
 * budget-fresh cursor as its own retry and would refuse every continuation
 * page.
 */
type OpenedScan =
  | {
      kind: "scanning";
      batch: RecoveryBatch;
      cursor: RecoveryScanCursor;
      commit: ScoutDurableCommitV2;
    }
  | {
      kind: "refused";
      commit: ScoutDurableCommitV2;
      state: RecoveryBatchState;
    };

async function openRecoveryScan(
  recoveryBatchId: RecoveryBatchId,
): Promise<OpenedScan> {
  const batch = await requireRecoveryBatch(recoveryBatchId);
  if (batch.state.kind === "scanning") {
    return {
      kind: "scanning",
      batch,
      cursor: batch.state.cursor,
      commit: NOTHING_COMMITTED,
    };
  }
  const commit = await commitRecoveryTransition(recoveryBatchId, (candidate) =>
    beginScan(candidate, { pageBudget: RECOVERY_SCAN_PAGE_BUDGET }),
  );
  const opened = await requireRecoveryBatch(recoveryBatchId);
  return opened.state.kind === "scanning"
    ? { kind: "scanning", batch: opened, cursor: opened.state.cursor, commit }
    : { kind: "refused", commit, state: opened.state };
}

/**
 * One page of the batch's archive range: how much of it is still a gap, and
 * where the next page starts.
 *
 * The upper bound is the batch row's own `createdAt`, and it is what makes a
 * batch a fixed unit of work. A batch recovers the work that existed when it
 * was created; a match archived after that belongs to the live pipeline, which
 * is still running and still owns it. Because receipts are append-only, that
 * bound cannot move, so the page count a scan walks is settled the moment the
 * batch row is written.
 *
 * `discovered` counts MATCHES rather than receipt rows. Receipt identity
 * includes the version and the scope, so one match may carry more than one
 * `raw-archive-match` row and a page could hold both; counting rows would make
 * the scan's report disagree with the count the processing phase freezes.
 *
 * A page that comes back empty carries no `nextPosition`, and that is not a
 * degenerate case to paper over: the cursor already stands at the end of the
 * range, `advanceScanCursor` has no transition to nowhere, and the scan is
 * finished.
 */
async function readRecoveryScanPage(
  batch: RecoveryBatch,
  cursor: RecoveryScanCursor,
): Promise<{
  discovered: number;
  nextPosition: string | undefined;
  exhausted: boolean;
}> {
  const page = await listArchivedMatchPage(prisma, {
    archiveReceiptKind: rawArchiveReceiptKind("match"),
    recordedThrough: dateFromIsoInstant(batch.createdAt),
    after:
      cursor.position === undefined
        ? undefined
        : recoveryScanPosition(cursor.position),
    limit: RECOVERY_SCAN_PAGE_SIZE,
  });
  const last = page.at(-1);
  if (last === undefined) {
    return { discovered: 0, nextPosition: undefined, exhausted: true };
  }
  const riotMatchIds = [...new Set(page.map((entry) => entry.riotMatchId))];
  const observed = new Set<string>(
    await listObservedMatches(prisma, { riotMatchIds }),
  );
  return {
    discovered: riotMatchIds.filter((id) => !observed.has(id)).length,
    nextPosition: recoveryScanToken(last),
    exhausted: page.length < RECOVERY_SCAN_PAGE_SIZE,
  };
}

/**
 * Whether the scan has anywhere left to go.
 *
 * The budget is spent and the range is exhausted deliberately collapse into one
 * answer, because the caller does the same thing with both: it stops scanning
 * and moves on to processing what it has. They differ only in what an operator
 * should conclude, and the cursor columns on the row already record which it
 * was.
 */
function scanFinished(state: RecoveryBatchState): boolean {
  return (
    state.kind !== "scanning" ||
    state.cursor.pagesScanned >= state.cursor.pageBudget
  );
}

/**
 * Survey one page of the gap and move the cursor over it.
 *
 * The cursor advance carries the position the page was read FROM, so a delayed
 * retry of an earlier page conflicts through the machine's own `stale-cursor`
 * answer instead of rewinding the cursor and spending the budget twice.
 */
export async function scanRecoveryPageV2(
  input: ScoutRecoveryBatchRefV2,
): Promise<ScoutRecoveryScanV2Result> {
  const opened = await openRecoveryScan(input.recoveryBatchId);
  if (opened.kind === "refused") {
    return ScoutRecoveryScanV2ResultSchema.parse({
      commit: opened.commit,
      state: opened.state,
      discovered: 0,
      complete: true,
    });
  }
  const page = await readRecoveryScanPage(opened.batch, opened.cursor);
  if (page.nextPosition === undefined) {
    return ScoutRecoveryScanV2ResultSchema.parse({
      commit: opened.commit,
      state: opened.batch.state,
      discovered: page.discovered,
      complete: true,
    });
  }
  const advanced = durableCommitV2(
    recoveryCommitResult(
      await advanceRecoveryCursor(prisma, {
        recoveryBatchId: input.recoveryBatchId,
        expectedPosition: opened.cursor.position,
        nextPosition: page.nextPosition,
      }),
    ),
  );
  const state = await recoveryBatchState(input.recoveryBatchId);
  return ScoutRecoveryScanV2ResultSchema.parse({
    commit: pageCommit(opened.commit, advanced),
    state,
    discovered: page.discovered,
    complete: page.exhausted || scanFinished(state),
  });
}

/**
 * A batch positioned to process, or the machine's reason it cannot be.
 *
 * The count is issued exactly once, on the `scanning` batch, and
 * `beginProcessing` freezes it as `discovered` for the life of the batch. Every
 * later page reads it back off the row instead of recounting, and that is what
 * makes the tally converge: the range shrinks as the live pipeline observes
 * matches in it, so a recount would move the target the tally is chasing and
 * `beginDigest` would never be satisfiable.
 *
 * A batch in a state that cannot process gets the machine's refusal evaluated
 * against the snapshot rather than committed through the repository, and the
 * difference is not stylistic. A batch found in `planned` may be moved to
 * `scanning` by the driver that owns it, and a committed `beginProcessing`
 * carrying the placeholder count would then APPLY — freezing `discovered` at
 * zero for a batch with real work in front of it. The refusal is identical
 * either way; only the risk differs.
 */
type OpenedProcessing =
  | {
      kind: "processing";
      batch: RecoveryBatch;
      counts: RecoveryCounts;
      commit: ScoutDurableCommitV2;
    }
  | {
      kind: "refused";
      commit: ScoutDurableCommitV2;
      state: RecoveryBatchState;
    };

async function openRecoveryProcessing(
  recoveryBatchId: RecoveryBatchId,
): Promise<OpenedProcessing> {
  const batch = await requireRecoveryBatch(recoveryBatchId);
  if (batch.state.kind === "processing") {
    return {
      kind: "processing",
      batch,
      counts: batch.state.counts,
      commit: NOTHING_COMMITTED,
    };
  }
  if (batch.state.kind !== "scanning") {
    return {
      kind: "refused",
      commit: durableCommitV2(
        recoveryCommitResult(beginProcessing(batch, { discovered: 0 })),
      ),
      state: batch.state,
    };
  }
  const discovered = await countRecoverableMatches(prisma, {
    archiveReceiptKind: rawArchiveReceiptKind("match"),
    recordedThrough: dateFromIsoInstant(batch.createdAt),
  });
  const commit = await commitRecoveryTransition(recoveryBatchId, (candidate) =>
    beginProcessing(candidate, { discovered }),
  );
  const opened = await requireRecoveryBatch(recoveryBatchId);
  return opened.state.kind === "processing"
    ? { kind: "processing", batch: opened, counts: opened.state.counts, commit }
    : { kind: "refused", commit, state: opened.state };
}

/** How one item of a recovery page turned out, in the tally's own vocabulary. */
type RecoveryItemOutcome = "succeeded" | "suppressed" | "failed";

/**
 * Recover one match: record that Scout saw it, and nothing else.
 *
 * The observation is `ARCHIVE_ONLY` and owned by `temporal-v2`. The owner is
 * what stops two pipelines from both deciding they are settling this match, and
 * the policy is what stops this one from settling it at all — a recovery batch
 * captures the fact, and the promotion path exists for the separate decision to
 * run the rest.
 *
 * The artifact identity is stamped from the `raw-archive-match` receipt's own
 * evidence, which is the whole reason the receipt carries a descriptor: the run
 * that archived these bytes is gone, and reconstructing a key from the layout
 * convention would be evidence of nothing. A receipt with no descriptor is what
 * put this match in the batch in the first place and cannot be worked around —
 * the producer wrote an unevidenced claim, and every artifact column this batch
 * could fill would be a guess.
 *
 * A match that gained an observation since the page was read is `suppressed`
 * rather than a failure: the live pipeline reached it first, which is the
 * outcome the batch wanted anyway. A `conflict` is `failed` because it means
 * two producers disagree about what is true of this match, and that is a person's
 * problem rather than a retry's.
 */
async function recoverArchivedMatch(
  riotMatchId: RiotMatchId,
): Promise<RecoveryItemOutcome> {
  const observed = await getObservation(prisma, { matchId: riotMatchId });
  if (observed !== null) {
    return "suppressed";
  }
  const archived = await readArchivedMatchArtifactV2(riotMatchId);
  if (archived === null) {
    throw ApplicationFailure.nonRetryable(
      `${riotMatchId} is in this recovery batch because it carries a raw-archive-match receipt, but that receipt names no archived artifact`,
      "MissingDomainRecord",
    );
  }
  const context = await resolveScoutV2MatchContext(riotMatchId);
  const commit = durableCommitV2(
    await observeMatch(prisma, {
      matchId: riotMatchId,
      platformRoute: platformRouteOf(riotMatchId),
      policy: "ARCHIVE_ONLY",
      owner: { kind: "temporal-v2" },
      promotion: null,
      gameCreatedAt: isoInstantFromEpochMs(context.matchData.info.gameCreation),
      observedAt: toIsoInstant(new Date()),
      artifacts: {
        match: { key: archived.key, digest: archived.digest },
        timeline: null,
      },
    }),
  );
  return commit.outcome === "conflict" ? "failed" : "succeeded";
}

/**
 * Work one page off the front of the remaining gap, and keep the tally
 * cumulative.
 *
 * There is no cursor to carry. An item leaves the gap the moment its
 * observation is committed, so the durable state IS the watermark and the next
 * page starts where this one stopped — which is also why the `processing` state
 * has count columns where `scanning` has cursor columns.
 *
 * A short page means the gap is empty, and the SHORTFALL then belongs to
 * `suppressed`. `beginDigest` refuses with `items-unaccounted` unless the three
 * outcomes add up to `discovered`, and they will not: `discovered` was frozen
 * over the gap as it stood at the count, and every match the live pipeline
 * observed in the meantime silently left it. Those are items this batch counted
 * and somebody else handled — which is precisely what `suppressed` means for
 * the items this page saw individually — so attributing the remainder there
 * states the same fact about the same kind of item. Attributing it to `failed`
 * would invent failures that never happened, and leaving it unattributed would
 * strand the batch one transition short of its digest forever.
 */
async function processRecoveryItems(
  batch: RecoveryBatch,
  counts: RecoveryCounts,
): Promise<RecoveryCounts> {
  const remaining = await listRecoverableMatches(prisma, {
    archiveReceiptKind: rawArchiveReceiptKind("match"),
    recordedThrough: dateFromIsoInstant(batch.createdAt),
    limit: RECOVERY_PROCESS_PAGE_SIZE,
  });
  const tally = { ...counts };
  for (const riotMatchId of remaining) {
    const outcome = await recoverArchivedMatch(riotMatchId);
    tally[outcome] += 1;
  }
  if (remaining.length < RECOVERY_PROCESS_PAGE_SIZE) {
    tally.suppressed +=
      tally.discovered - (tally.succeeded + tally.suppressed + tally.failed);
  }
  return tally;
}

/** The batch's own tally while the row still holds one. */
function recoveryCountsOf(state: RecoveryBatchState): RecoveryCounts {
  return state.kind === "processing" ? state.counts : NO_COUNTS;
}

/**
 * Whether another processing page could add anything.
 *
 * Derived from the STORED tally rather than from the page that just ran,
 * because the two can disagree: a progress record that lost its guard race
 * leaves the row short of the tally this call computed, and reporting
 * `complete` on that would send the Workflow to a digest the machine refuses.
 * Asking the row instead makes the next page redo the arithmetic, which is
 * harmless — `recordProcessingProgress` compares cumulative counts, so the same
 * page recomputed is `already-applied`.
 */
function processingFinished(state: RecoveryBatchState): boolean {
  return (
    state.kind !== "processing" ||
    state.counts.succeeded + state.counts.suppressed + state.counts.failed ===
      state.counts.discovered
  );
}

/** Recover one bounded page of the batch's gap and record what it did. */
export async function processRecoveryPageV2(
  input: ScoutRecoveryBatchRefV2,
): Promise<ScoutRecoveryProcessV2Result> {
  const opened = await openRecoveryProcessing(input.recoveryBatchId);
  if (opened.kind === "refused") {
    return ScoutRecoveryProcessV2ResultSchema.parse({
      commit: opened.commit,
      state: opened.state,
      counts: recoveryCountsOf(opened.state),
      complete: true,
    });
  }
  const counts = await processRecoveryItems(opened.batch, opened.counts);
  const progress = await commitRecoveryTransition(
    input.recoveryBatchId,
    (candidate) => recordProcessingProgress(candidate, { counts }),
  );
  const state = await recoveryBatchState(input.recoveryBatchId);
  return ScoutRecoveryProcessV2ResultSchema.parse({
    commit: pageCommit(opened.commit, progress),
    state,
    counts: recoveryCountsOf(state),
    complete: processingFinished(state),
  });
}

/**
 * One closing transition on a batch that must already exist.
 *
 * The existence check comes first and costs a read, because the repository
 * answers a missing row mid-transition with a plain error and a Workflow driving
 * an id nothing created deserves the failure that names itself rather than one
 * that retries.
 */
async function commitRecoveryBatchV2(
  recoveryBatchId: RecoveryBatchId,
  transition: (batch: RecoveryBatch) => RecoveryTransitionResult,
): Promise<ScoutRecoveryTransitionV2Result> {
  await requireRecoveryBatch(recoveryBatchId);
  const commit = await commitRecoveryTransition(recoveryBatchId, transition);
  const state = await recoveryBatchState(recoveryBatchId);
  return ScoutRecoveryTransitionV2ResultSchema.parse({ commit, state });
}

/**
 * Close the processing phase and hand the batch to its digest.
 *
 * The machine refuses with `items-unaccounted` while the tally is short of
 * `discovered`, which is the guard that stops a batch being reported as
 * recovered when part of its range was never looked at.
 */
export async function digestRecoveryBatchV2(
  input: ScoutRecoveryBatchRefV2,
): Promise<ScoutRecoveryTransitionV2Result> {
  return await commitRecoveryBatchV2(input.recoveryBatchId, beginDigest);
}

/**
 * End the batch, either way.
 *
 * Abandonment carries its reason into the row because it is the only record
 * that survives the run: `scan-budget-exhausted` and `operator-cancelled` are
 * the difference between a batch that needs a successor and one that must not
 * have one.
 */
export async function closeRecoveryBatchV2(
  input: ScoutRecoveryCloseV2Input,
): Promise<ScoutRecoveryTransitionV2Result> {
  const close = input.close;
  return await commitRecoveryBatchV2(input.recoveryBatchId, (batch) =>
    close.outcome === "complete"
      ? completeBatch(batch)
      : abandonBatch(batch, { reason: close.reason }),
  );
}
