import type {
  NotificationIntentKey,
  RecoveryBatchId,
  RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutReconciliationScanV2ResultSchema,
  type ScoutReconciliationScanV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutStage } from "@scout-for-lol/temporal/contracts";
import { SCOUT_V2_PAGE_MAX } from "@scout-for-lol/temporal/contracts-v2";
import {
  SCOUT_WORKFLOW_NAMES,
  type ScoutV2WorkflowName,
} from "@scout-for-lol/temporal/identifiers";
import {
  SCOUT_V2_MATCH_RECEIPT_KINDS,
  SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
} from "@scout-for-lol/temporal/match-receipts-v2";
import {
  scoutLakeProjectionV2InputCodec,
  scoutMatchProcessingV2InputCodec,
  scoutNotificationV2InputCodec,
  scoutRecoveryBatchV2InputCodec,
  type ScoutPipelineReconciliationV2Input,
} from "@scout-for-lol/temporal/workflow-contracts-v2";
import { prisma } from "#src/database/index.ts";
import {
  listLiveRecoveryBatches,
  listStalledNotificationIntents,
  listStalledV2MatchProcessing,
  listUnacceptedWorkflowStarts,
  listUnprojectedLakeMatches,
} from "#src/database/durable/pipeline-scan.ts";
import type { VersionedPayloadEnvelope } from "@scout-for-lol/domain/codec/versioned.ts";
import type { ScoutWorkflowStartRecord } from "@scout-for-lol/domain/recovery/workflow-start.ts";
import {
  lakeStagingReceiptKind,
  rawArchiveReceiptKind,
} from "#src/report-lake/durable-receipts.ts";

/**
 * The V2 pipeline's reconciliation scan: one bounded page of work that nothing
 * is currently driving.
 *
 * The page is re-derived from the durable tables on every run rather than from
 * a stored position, and the Workflow input carries no cursor for the same
 * reason. The durable state IS the watermark: work leaves a family when the
 * child that drives it commits, so a sweep that starts the same child twice
 * collapses onto one deterministic Workflow ID, and a sweep that finds nothing
 * is the pipeline being healthy rather than a cursor that ran off the end.
 *
 * `complete` is false exactly when a family FILLED its page. It is deliberately
 * not false merely because something was found: a family with room to spare has
 * handed over its whole backlog, and a caller that kept sweeping on that signal
 * would never stop. This is why the reads in `database/durable/pipeline-scan.ts`
 * push their filters into SQL instead of trimming a fetched window — a short
 * page has to mean a short backlog for that inference to hold.
 *
 * The receipt-kind vocabulary lives on this side of the boundary. The kinds
 * belong to the workflows that emit them (`report-lake/` for archive and
 * staging, the temporal package for the V2 stage kinds), and the scan module
 * takes them as arguments so a repository stays callable without dragging a
 * feature slice in behind it.
 */

/** The four families the result contract names, as the fold accumulates them. */
type PendingStarts = {
  matchProcessing: RiotMatchId[];
  notifications: NotificationIntentKey[];
  lakeProjections: RiotMatchId[];
  recoveryBatches: RecoveryBatchId[];
};

/**
 * Decode one unacknowledged start into the family it asked for, and report the
 * stage its input named so the caller can check it against the run's.
 */
type StartFold = (
  record: ScoutWorkflowStartRecord,
  pending: PendingStarts,
) => ScoutStage;

/**
 * The stored envelope, re-addressed to the codec that owns its shape.
 *
 * `ScoutWorkflowStart` carries an expected-kind contract of its own: the record
 * schema and a migration CHECK pin `inputPayload.kind` to the row's
 * `workflowType`, so a stored envelope is kinded by the WORKFLOW TYPE
 * (`scoutMatchProcessingV2Workflow`) while the input codec is kinded by the
 * PAYLOAD SHAPE (`scout-match-processing-v2-input`). One string cannot satisfy
 * both, so handing the row's envelope to the codec unchanged always fails on
 * the kind literal and no V2 start could ever be folded in.
 *
 * Only the kind is re-addressed. The version and the data stay the row's, and
 * they are what actually decides whether this start parses: an envelope at a
 * version the codec has no migration chain for is still rejected, and `data` is
 * still validated against the current input schema, so a payload that does not
 * describe the work it claims to fails here rather than becoming a child
 * Workflow started on nonsense.
 */
function requestedInputEnvelope(
  codec: { readonly kind: string },
  record: ScoutWorkflowStartRecord,
): VersionedPayloadEnvelope {
  return {
    kind: codec.kind,
    version: record.inputPayload.version,
    data: record.inputPayload.data,
  };
}

/**
 * What an unacknowledged start of each V2 Workflow Type adds to the page.
 *
 * Exhaustive over `SCOUT_V2_WORKFLOW_NAMES`, so a ninth V2 type has to be
 * classified here before this file compiles — which is the only thing standing
 * between a new Workflow Type and a stranded request for it that no sweep ever
 * looks at.
 *
 * Five of the nine map to nothing, and that is a statement about the result
 * contract rather than about the work. `ScoutReconciliationScanV2Result` names
 * four families and those five are none of them. They are keyed by stage,
 * trigger or a live game rather than by a durable row, so their schedule or
 * next client signal re-requests the identical Workflow ID and collapses onto
 * whatever is already in flight; no durable row is stranded by omitting them.
 */
const V2_START_FOLDS = {
  [SCOUT_WORKFLOW_NAMES.postMatchDiscoveryV2]: null,
  [SCOUT_WORKFLOW_NAMES.clientMatchDispatchV2]: null,
  [SCOUT_WORKFLOW_NAMES.prematchDiscoveryV2]: null,
  [SCOUT_WORKFLOW_NAMES.prematchGameV2]: null,
  [SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2]: null,
  [SCOUT_WORKFLOW_NAMES.matchProcessingV2]: (record, pending) => {
    const requested = scoutMatchProcessingV2InputCodec.parse(
      requestedInputEnvelope(scoutMatchProcessingV2InputCodec, record),
    );
    pending.matchProcessing.push(requested.riotMatchId);
    return requested.stage;
  },
  [SCOUT_WORKFLOW_NAMES.notificationV2]: (record, pending) => {
    const requested = scoutNotificationV2InputCodec.parse(
      requestedInputEnvelope(scoutNotificationV2InputCodec, record),
    );
    pending.notifications.push(requested.intentKey);
    return requested.stage;
  },
  [SCOUT_WORKFLOW_NAMES.lakeProjectionV2]: (record, pending) => {
    const requested = scoutLakeProjectionV2InputCodec.parse(
      requestedInputEnvelope(scoutLakeProjectionV2InputCodec, record),
    );
    pending.lakeProjections.push(requested.riotMatchId);
    return requested.stage;
  },
  [SCOUT_WORKFLOW_NAMES.recoveryBatchV2]: (record, pending) => {
    const requested = scoutRecoveryBatchV2InputCodec.parse(
      requestedInputEnvelope(scoutRecoveryBatchV2InputCodec, record),
    );
    pending.recoveryBatches.push(requested.recoveryBatchId);
    return requested.stage;
  },
} satisfies Record<ScoutV2WorkflowName, StartFold | null>;

const FOLD_BY_WORKFLOW_TYPE: ReadonlyMap<string, StartFold | null> = new Map(
  Object.entries(V2_START_FOLDS),
);

/** The types worth reading: the rest have no family to be folded into. */
const FOLDABLE_WORKFLOW_TYPES: readonly string[] = [
  ...FOLD_BY_WORKFLOW_TYPE.entries(),
]
  .filter(([, fold]) => fold !== null)
  .map(([workflowType]) => workflowType);

/**
 * Turn the unacknowledged start rows into the work they asked for.
 *
 * Both refusals here are broken internal contracts rather than degraded modes.
 * A row whose type has no fold came back from a read that was filtered to the
 * folds' own key set, so the two have drifted apart. A row whose input names a
 * different stage is a request this run cannot own at all: a V2 Workflow ID is
 * built from the stage, so starting it from here would produce an execution
 * keyed to this stage carrying its neighbour's input — a different child from
 * the one that was asked for, under a name that hides the difference. Neither
 * is something to skip past; the durable tables carry no stage column precisely
 * because a deployment's database is its stage, and a row that disagrees means
 * that assumption has stopped holding.
 */
function foldWorkflowStarts(args: {
  starts: readonly ScoutWorkflowStartRecord[];
  stage: ScoutStage;
}): PendingStarts {
  const pending: PendingStarts = {
    matchProcessing: [],
    notifications: [],
    lakeProjections: [],
    recoveryBatches: [],
  };
  for (const record of args.starts) {
    const fold = FOLD_BY_WORKFLOW_TYPE.get(record.workflowType);
    if (fold === undefined || fold === null) {
      throw new Error(
        `Workflow start ${record.requestedWorkflowId} is a ${record.workflowType} start, which the reconciliation sweep does not drive`,
      );
    }
    const requestedStage = fold(record, pending);
    if (requestedStage !== args.stage) {
      throw new Error(
        `Workflow start ${record.requestedWorkflowId} requests stage ${requestedStage} from a ${args.stage} reconciliation run`,
      );
    }
  }
  return pending;
}

/**
 * One family's page: what the durable state found, then what was requested and
 * never acknowledged, deduplicated and capped.
 *
 * The state-derived ids come first because they are the stronger evidence — a
 * row exists and says the work is unfinished — while an unacknowledged start is
 * only evidence that someone asked. When both name the same work the page
 * carries it once, in the position the state gave it, so a match that is both
 * stalled and re-requested does not cost two slots.
 *
 * The cap is applied here rather than left to the result schema because the
 * caller needs to know it happened. A family at the budget means the backlog
 * outran this page and another sweep is owed; truncating quietly would report
 * the opposite.
 */
function reconciliationPage<Id extends string>(
  stateDerived: readonly Id[],
  requested: readonly Id[],
): { ids: Id[]; full: boolean } {
  const merged = [...new Set([...stateDerived, ...requested])];
  return {
    ids: merged.slice(0, SCOUT_V2_PAGE_MAX),
    full: merged.length >= SCOUT_V2_PAGE_MAX,
  };
}

/**
 * Scan one reconciliation page.
 *
 * The five reads run concurrently because they are independent questions of
 * independent tables and nothing here reasons about a consistent snapshot
 * across them: a match that finishes between two of these queries is simply
 * absent from the next sweep, which is the outcome either ordering produces.
 *
 * The freshness clock is read once, before any of them, so every intent on a
 * page is judged stale or stalled against the same instant. Reading it per
 * query would let an intent expire between two reads and make the page's
 * contents depend on how long the database took.
 */
export async function scanPipelineReconciliationPageV2(
  input: ScoutPipelineReconciliationV2Input,
): Promise<ScoutReconciliationScanV2Result> {
  const freshAt = new Date();
  const [
    stalledMatches,
    stalledIntents,
    unprojectedMatches,
    liveBatches,
    unacceptedStarts,
  ] = await Promise.all([
    listStalledV2MatchProcessing(prisma, {
      observationReceiptKind: SCOUT_V2_MATCH_RECEIPT_KINDS.observation,
      // Contested matches refuse at their resume point until an operator
      // acts; the sweep would start a failing child per tick for each.
      contested: {
        kind: "exclude",
        stageConflictReceiptKind: SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
      },
      limit: SCOUT_V2_PAGE_MAX,
    }),
    listStalledNotificationIntents(prisma, {
      freshAt,
      // A prematch intent whose match already carries an observation announces
      // a game the pipeline knows has ENDED; the freshness deadline is the
      // game's three-hour TTL and does not cover it, so the sweep would post
      // "game starting" after the result was public. The exclusion is by
      // TRUTH WINDOW rather than by "postmatch only" on purpose: settlement
      // and dare-summary rows are minted inside the fenced settlement effect
      // and must still be driven.
      overtakenByResult: "exclude",
      limit: SCOUT_V2_PAGE_MAX,
    }),
    listUnprojectedLakeMatches(prisma, {
      archiveReceiptKind: rawArchiveReceiptKind("match"),
      stagingReceiptKind: lakeStagingReceiptKind("match"),
      limit: SCOUT_V2_PAGE_MAX,
    }),
    listLiveRecoveryBatches(prisma, { limit: SCOUT_V2_PAGE_MAX }),
    listUnacceptedWorkflowStarts(prisma, {
      workflowTypes: FOLDABLE_WORKFLOW_TYPES,
      limit: SCOUT_V2_PAGE_MAX,
    }),
  ]);

  const requested = foldWorkflowStarts({
    starts: unacceptedStarts,
    stage: input.stage,
  });
  // The reads carry each row's ordering value so an operator surface can page
  // and date them; the sweep only ever wants the identity, and takes it here.
  const pages = {
    matchProcessing: reconciliationPage(
      stalledMatches.map((row) => row.riotMatchId),
      requested.matchProcessing,
    ),
    notifications: reconciliationPage(
      stalledIntents.map((record) => record.intent.key),
      requested.notifications,
    ),
    lakeProjections: reconciliationPage(
      unprojectedMatches.map((row) => row.riotMatchId),
      requested.lakeProjections,
    ),
    recoveryBatches: reconciliationPage(
      liveBatches.map((row) => row.recoveryBatchId),
      requested.recoveryBatches,
    ),
  };

  return ScoutReconciliationScanV2ResultSchema.parse({
    complete: !Object.values(pages).some((page) => page.full),
    pending: {
      matchProcessing: pages.matchProcessing.ids,
      notifications: pages.notifications.ids,
      lakeProjections: pages.lakeProjections.ids,
      recoveryBatches: pages.recoveryBatches.ids,
    },
  });
}
