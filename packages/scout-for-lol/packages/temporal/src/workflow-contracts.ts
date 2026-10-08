import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  MatchDeliveryModeSchema,
  MatchProcessingPolicySchema,
  PipelineOwnerSchema,
  ReceiptKindSchema,
} from "@scout-for-lol/domain/match-processing/states.ts";
import {
  NotificationIntentStateSchema,
  NotificationTargetKindSchema,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  RecoveryBatchStateSchema,
  RecoveryCountsSchema,
  RecoveryPolicySchema,
} from "@scout-for-lol/domain/recovery/batch.ts";
import { ScoutStageSchema, ScoutWorkflowStatusSchema } from "./contracts.ts";
import {
  SCOUT_CONTRACT_VERSION,
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
  ScoutRecoveryBatchIdSchema,
  ScoutTriggerSchema,
} from "./pipeline-contracts.ts";

/** The envelope type a codec produces, without restating its kind literal. */
type EnvelopeOf<
  Codec extends { readonly serialize: (value: never) => unknown },
> = ReturnType<Codec["serialize"]>;

// ─── V2 Workflow inputs ────────────────────────────────────────────────────

export const ScoutPostMatchDiscoveryInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  trigger: ScoutTriggerSchema,
});
export type ScoutPostMatchDiscoveryInput = z.infer<
  typeof ScoutPostMatchDiscoveryInputSchema
>;

/**
 * The per-match core is keyed by nothing but the match it processes.
 *
 * Spelled out rather than aliased to `ScoutMatchRefSchema`: the Workflow
 * input and the Activity reference happen to agree today, and a frozen
 * Workflow contract must not change because an Activity reference did.
 *
 * `sourcePuuid` is the tracked account whose match history surfaced this
 * match, when the run was started by discovery. It restores v1's
 * precondition — `ingestDiscoveredMatch` refuses a match whose discovering
 * account is no longer tracked — which `commitMatchObservation` checks
 * before any downstream effect. It is optional because not every starter has
 * one: a reconciliation restart resumes an already-observed match from its
 * durable state, where the precondition was checked when the observation
 * was committed, so its absence there is handled explicitly and is not a
 * fallback. Additive on a frozen envelope, so an input recorded without it
 * still replays.
 *
 * `deliveryMode` is optional for the same reason and answers to the same
 * rule. Only the discovery pass knows whether a match is owed a public
 * delivery, so a discovery-started run carries the mode and the observation
 * commits it as a durable fact. A run started WITHOUT one — a reconciliation
 * restart — takes the mode the observation already standing for the match
 * recorded, because re-deciding it is precisely how a silent backfill would
 * come to announce itself. A run with neither an input mode nor a stored
 * observation has no evidence either way and fails rather than choosing.
 */
export const ScoutMatchProcessingInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  riotMatchId: RiotMatchIdSchema,
  sourcePuuid: LeaguePuuidSchema.optional(),
  deliveryMode: MatchDeliveryModeSchema.optional(),
});
export type ScoutMatchProcessingInput = z.infer<
  typeof ScoutMatchProcessingInputSchema
>;

/**
 * One complete native-client match waiting for the serialized dispatcher.
 *
 * `readyAt` is chosen by ingress after the observation is committed. It gives
 * Riot the same first-refusal window as canonical local-match selection,
 * without making the HTTP request or an individual match Workflow sleep.
 * `gameEndTimestamp` is the ordering fact from the validated canonical match;
 * it is never taken from an unparsed client field.
 */
export const ScoutClientMatchDispatchItemSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  sourcePuuid: LeaguePuuidSchema,
  deliveryMode: MatchDeliveryModeSchema,
  gameEndTimestamp: z.int().nonnegative(),
  readyAt: IsoInstantSchema,
  completionTargets: z
    .array(
      z.strictObject({
        workflowId: z.string().min(1).max(255),
        runId: z.string().min(1).max(255),
      }),
    )
    .max(20)
    .readonly(),
});
export type ScoutClientMatchDispatchItem = z.infer<
  typeof ScoutClientMatchDispatchItemSchema
>;

/** A signal is bounded by the native ingress batch limit. */
export const ScoutClientMatchDispatchBatchSchema = z
  .array(ScoutClientMatchDispatchItemSchema)
  .min(1)
  .max(100)
  .readonly();
export type ScoutClientMatchDispatchBatch = z.infer<
  typeof ScoutClientMatchDispatchBatchSchema
>;

/**
 * Pending work crosses Continue-As-New so an accepted signal is never lost.
 * The larger bound permits a short burst from several clients while keeping
 * the Workflow payload well below Temporal's service limit.
 */
const ScoutClientMatchDispatchV1InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  pending: z.array(ScoutClientMatchDispatchItemSchema).max(5000).readonly(),
});

export const ScoutClientMatchDispatchOrderKeySchema = z.strictObject({
  gameEndTimestamp: z.int().nonnegative(),
  riotMatchId: RiotMatchIdSchema,
});
export type ScoutClientMatchDispatchOrderKey = z.infer<
  typeof ScoutClientMatchDispatchOrderKeySchema
>;

/**
 * `orderingWatermark` is the last match whose ordered processing began. A
 * newly arriving offline match that sorts before it can no longer be safely
 * settled, because effects for the watermark match may already be durable.
 * Such arrivals remain in `lateArrivals` until their review marker and exact
 * requester acknowledgement are both durable.
 */
export const ScoutClientMatchDispatchInputSchema = z
  .strictObject({
    stage: ScoutStageSchema,
    pending: z.array(ScoutClientMatchDispatchItemSchema).max(5000).readonly(),
    lateArrivals: z
      .array(ScoutClientMatchDispatchItemSchema)
      .max(5000)
      .readonly(),
    orderingWatermark: ScoutClientMatchDispatchOrderKeySchema.nullable(),
  })
  .superRefine((input, context) => {
    if (input.pending.length + input.lateArrivals.length <= 5000) return;
    context.addIssue({
      code: "custom",
      message: "combined dispatcher queue exceeds 5000 matches",
      path: ["lateArrivals"],
    });
  });
export type ScoutClientMatchDispatchInput = z.infer<
  typeof ScoutClientMatchDispatchInputSchema
>;

/** Completion acknowledgement sent to the exact discovery run that waited. */
export const ScoutClientMatchDispatchResultSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  outcome: z.enum(["processed", "already-complete", "terminal-failure"]),
  failureType: z.string().min(1).max(160).optional(),
});
export type ScoutClientMatchDispatchResult = z.infer<
  typeof ScoutClientMatchDispatchResultSchema
>;

export const ScoutPrematchDiscoveryInputSchema = z.strictObject({
  stage: ScoutStageSchema,
});
export type ScoutPrematchDiscoveryInput = z.infer<
  typeof ScoutPrematchDiscoveryInputSchema
>;

export const ScoutPrematchGameInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  gameRef: ScoutPrematchGameRefSchema,
});
export type ScoutPrematchGameInput = z.infer<
  typeof ScoutPrematchGameInputSchema
>;

export const ScoutNotificationInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  intentKey: ScoutNotificationIntentKeySchema,
});
export type ScoutNotificationInput = z.infer<
  typeof ScoutNotificationInputSchema
>;

export const ScoutLakeProjectionInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  riotMatchId: RiotMatchIdSchema,
});
export type ScoutLakeProjectionInput = z.infer<
  typeof ScoutLakeProjectionInputSchema
>;

/**
 * A recovery batch carries no cursor in its input, and that is deliberate.
 * The scan position, page budget and counts live in the durable batch row,
 * which is the whole reason the row exists: a Continue-As-New that re-serialized
 * them would give the batch two sources of truth that a crash between the
 * cursor write and the Continue-As-New could disagree about.
 */
export const ScoutRecoveryBatchInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  recoveryBatchId: ScoutRecoveryBatchIdSchema,
});
export type ScoutRecoveryBatchInput = z.infer<
  typeof ScoutRecoveryBatchInputSchema
>;

/**
 * Reconciliation likewise carries no cursor. Its scan is idempotent and
 * resumes from the durable watermark each run, so a Continue-As-New repeats
 * the input unchanged.
 */
export const ScoutPipelineReconciliationInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  trigger: ScoutTriggerSchema,
});
export type ScoutPipelineReconciliationInput = z.infer<
  typeof ScoutPipelineReconciliationInputSchema
>;

export const scoutPostMatchDiscoveryInputCodec = defineVersionedCodec({
  kind: "scout-post-match-discovery-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutPostMatchDiscoveryInputSchema,
});
export const scoutMatchProcessingInputCodec = defineVersionedCodec({
  kind: "scout-match-processing-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutMatchProcessingInputSchema,
});
export const SCOUT_CLIENT_MATCH_DISPATCH_INPUT_VERSION = 2;

export const scoutClientMatchDispatchInputCodec = defineVersionedCodec({
  kind: "scout-client-match-dispatch-v2-input",
  version: SCOUT_CLIENT_MATCH_DISPATCH_INPUT_VERSION,
  schema: ScoutClientMatchDispatchInputSchema,
  migrations: {
    1: (old) => ({
      ...ScoutClientMatchDispatchV1InputSchema.parse(old),
      lateArrivals: [],
      orderingWatermark: null,
    }),
  },
});
export const scoutPrematchDiscoveryInputCodec = defineVersionedCodec({
  kind: "scout-prematch-discovery-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutPrematchDiscoveryInputSchema,
});
export const scoutPrematchGameInputCodec = defineVersionedCodec({
  kind: "scout-prematch-game-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutPrematchGameInputSchema,
});
export const scoutNotificationInputCodec = defineVersionedCodec({
  kind: "scout-notification-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutNotificationInputSchema,
});
export const scoutLakeProjectionInputCodec = defineVersionedCodec({
  kind: "scout-lake-projection-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutLakeProjectionInputSchema,
});
export const scoutRecoveryBatchInputCodec = defineVersionedCodec({
  kind: "scout-recovery-batch-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutRecoveryBatchInputSchema,
});
export const scoutPipelineReconciliationInputCodec = defineVersionedCodec({
  kind: "scout-pipeline-reconciliation-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutPipelineReconciliationInputSchema,
});

export type ScoutPostMatchDiscoveryInputEnvelope = EnvelopeOf<
  typeof scoutPostMatchDiscoveryInputCodec
>;
export type ScoutMatchProcessingInputEnvelope = EnvelopeOf<
  typeof scoutMatchProcessingInputCodec
>;
export type ScoutClientMatchDispatchInputEnvelope = EnvelopeOf<
  typeof scoutClientMatchDispatchInputCodec
>;
export type ScoutPrematchDiscoveryInputEnvelope = EnvelopeOf<
  typeof scoutPrematchDiscoveryInputCodec
>;
export type ScoutPrematchGameInputEnvelope = EnvelopeOf<
  typeof scoutPrematchGameInputCodec
>;
export type ScoutNotificationInputEnvelope = EnvelopeOf<
  typeof scoutNotificationInputCodec
>;
export type ScoutLakeProjectionInputEnvelope = EnvelopeOf<
  typeof scoutLakeProjectionInputCodec
>;
export type ScoutRecoveryBatchInputEnvelope = EnvelopeOf<
  typeof scoutRecoveryBatchInputCodec
>;
export type ScoutPipelineReconciliationInputEnvelope = EnvelopeOf<
  typeof scoutPipelineReconciliationInputCodec
>;

// ─── V2 Workflow results ───────────────────────────────────────────────────

export const ScoutPostMatchDiscoveryResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  discovered: z.int().nonnegative(),
  childrenStarted: z.int().nonnegative(),
  /** False when discovery could not see the whole tail of completed matches. */
  complete: z.boolean(),
});
export type ScoutPostMatchDiscoveryResult = z.infer<
  typeof ScoutPostMatchDiscoveryResultSchema
>;

export const ScoutMatchProcessingResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  riotMatchId: RiotMatchIdSchema,
  owner: PipelineOwnerSchema,
  policy: MatchProcessingPolicySchema,
  /**
   * The committed delivery mode this run operated under, read from the
   * durable observation rather than from the run's input.
   *
   * Reported because it governs what the run was allowed to do — a
   * silent-backfill match announces nothing — so a history that omitted it
   * could not explain why a run minted no visible delivery.
   */
  deliveryMode: MatchDeliveryModeSchema,
  /** Which facts this run attested to, in the order it recorded them. */
  receiptKinds: z.array(ReceiptKindSchema).readonly(),
  childrenStarted: z.strictObject({
    notifications: z.int().nonnegative(),
    lakeProjections: z.int().nonnegative(),
  }),
});
export type ScoutMatchProcessingResult = z.infer<
  typeof ScoutMatchProcessingResultSchema
>;

export const ScoutPrematchDiscoveryResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  discovered: z.int().nonnegative(),
  childrenStarted: z.int().nonnegative(),
  complete: z.boolean(),
});
export type ScoutPrematchDiscoveryResult = z.infer<
  typeof ScoutPrematchDiscoveryResultSchema
>;

export const ScoutPrematchGameResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  /** The match id the snapshot belongs to, composed from the game reference. */
  riotMatchId: RiotMatchIdSchema,
  receiptKinds: z.array(ReceiptKindSchema).readonly(),
  childrenStarted: z.strictObject({
    notifications: z.int().nonnegative(),
  }),
});
export type ScoutPrematchGameResult = z.infer<
  typeof ScoutPrematchGameResultSchema
>;

/**
 * What a notification run did with the intent it was given.
 *
 * `driven` is the ordinary run: the machine was stepped as far as it would
 * go. `held` is a run that read the intent, found its recovery policy does
 * not permit its target, and stopped before rendering or committing an
 * attempt — the intent is untouched, and the run's result says so rather
 * than presenting an unattempted send as a completed one.
 */
export const ScoutNotificationDispositionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("driven") }),
  z.strictObject({
    kind: z.literal("held"),
    policy: RecoveryPolicySchema,
    target: NotificationTargetKindSchema,
  }),
]);
export type ScoutNotificationDisposition = z.infer<
  typeof ScoutNotificationDispositionSchema
>;

/**
 * The intent's state when the Workflow stopped driving it. `unknown-delivery`
 * is a legitimate stopping point and NOT a failure: the machine leaves it only
 * through an operator resolution, because a retry could double-deliver.
 *
 * Version 2 adds `disposition`. Version-1 results were written by runs that
 * had no policy gate and so could only ever have driven the machine, which is
 * what the migration records for them.
 */
export const ScoutNotificationResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  intentKey: ScoutNotificationIntentKeySchema,
  state: NotificationIntentStateSchema,
  attemptCount: z.int().nonnegative(),
  disposition: ScoutNotificationDispositionSchema,
});
export type ScoutNotificationResult = z.infer<
  typeof ScoutNotificationResultSchema
>;

export const SCOUT_NOTIFICATION_RESULT_VERSION = 2;

export const ScoutLakeProjectionResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  riotMatchId: RiotMatchIdSchema,
  receiptKinds: z.array(ReceiptKindSchema).readonly(),
  stagedFileCount: z.int().nonnegative(),
});
export type ScoutLakeProjectionResult = z.infer<
  typeof ScoutLakeProjectionResultSchema
>;

/**
 * What THIS run can say about a recovery batch's tally.
 *
 * A batch carries counts only while it is `processing`. The durable row
 * flattens the state union, and `recoveryBatchStateColumns` builds every row
 * from a base whose count columns are null, filling them for `processing`
 * alone — so the transition into `digesting`, `complete` or `abandoned` writes
 * NULL over the tally, and the migration CHECKs make any other combination
 * unrepresentable. The counts are gone, not merely absent from the state
 * union, and no read can recover them.
 *
 * A run that drove the batch through processing watched the tally and reports
 * it. A run that a reconciliation sweep or an operator started onto a batch
 * already past processing never saw one, and `unobserved` is that answer said
 * out loud. Without it, such a run has two dishonest options: report zeros it
 * invented, or fail a batch that actually finished.
 *
 * The two axes are independent — a run that drove processing to completion
 * reports `observed` counts with a `complete` state — so this is a field on
 * the result rather than a split of it.
 */
export const ScoutRecoveryCountsReportSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("observed"),
    counts: RecoveryCountsSchema,
  }),
  z.strictObject({ kind: z.literal("unobserved") }),
]);
export type ScoutRecoveryCountsReport = z.infer<
  typeof ScoutRecoveryCountsReportSchema
>;

export const ScoutRecoveryBatchResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  recoveryBatchId: ScoutRecoveryBatchIdSchema,
  state: RecoveryBatchStateSchema,
  counts: ScoutRecoveryCountsReportSchema,
});
export type ScoutRecoveryBatchResult = z.infer<
  typeof ScoutRecoveryBatchResultSchema
>;

export const ScoutPipelineReconciliationResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  trigger: ScoutTriggerSchema,
  pagesScanned: z.int().nonnegative(),
  childrenStarted: z.strictObject({
    matchProcessing: z.int().nonnegative(),
    notifications: z.int().nonnegative(),
    lakeProjections: z.int().nonnegative(),
    recoveryBatches: z.int().nonnegative(),
  }),
});
export type ScoutPipelineReconciliationResult = z.infer<
  typeof ScoutPipelineReconciliationResultSchema
>;

export const scoutPostMatchDiscoveryResultCodec = defineVersionedCodec({
  kind: "scout-post-match-discovery-v2-result",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutPostMatchDiscoveryResultSchema,
});
/**
 * Version 2 adds `deliveryMode` to the per-match result.
 *
 * Its own constant rather than the shared contract version, because this
 * envelope has now moved independently of the others: a result recorded at
 * version 1 predates the field, and advertising version 1 while the schema
 * demanded it would have failed every historical parse. The notification
 * lane's result versioned the same way and for the same reason.
 */
export const SCOUT_MATCH_PROCESSING_RESULT_VERSION = 2;

export const scoutMatchProcessingResultCodec = defineVersionedCodec({
  kind: "scout-match-processing-v2-result",
  version: SCOUT_MATCH_PROCESSING_RESULT_VERSION,
  schema: ScoutMatchProcessingResultSchema,
  migrations: {
    // A version-1 result was produced when the per-match core treated every
    // match it observed as a live discovery — the observation commit recorded
    // `live` unconditionally — so `live` is not a guess here, it is what that
    // run actually operated under. It is also what the row-level migration
    // backfilled for observations written before the column existed.
    1: (old) => ({
      ...z.record(z.string(), z.unknown()).parse(old),
      deliveryMode: "live",
    }),
  },
});
export const scoutPrematchDiscoveryResultCodec = defineVersionedCodec({
  kind: "scout-prematch-discovery-v2-result",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutPrematchDiscoveryResultSchema,
});
export const scoutPrematchGameResultCodec = defineVersionedCodec({
  kind: "scout-prematch-game-v2-result",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutPrematchGameResultSchema,
});
export const scoutNotificationResultCodec = defineVersionedCodec({
  kind: "scout-notification-v2-result",
  version: SCOUT_NOTIFICATION_RESULT_VERSION,
  schema: ScoutNotificationResultSchema,
  migrations: {
    1: (old) => ({
      ...z.record(z.string(), z.unknown()).parse(old),
      disposition: { kind: "driven" },
    }),
  },
});
export const scoutLakeProjectionResultCodec = defineVersionedCodec({
  kind: "scout-lake-projection-v2-result",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutLakeProjectionResultSchema,
});
export const scoutRecoveryBatchResultCodec = defineVersionedCodec({
  kind: "scout-recovery-batch-v2-result",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutRecoveryBatchResultSchema,
});
export const scoutPipelineReconciliationResultCodec = defineVersionedCodec({
  kind: "scout-pipeline-reconciliation-v2-result",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutPipelineReconciliationResultSchema,
});

export type ScoutPostMatchDiscoveryResultEnvelope = EnvelopeOf<
  typeof scoutPostMatchDiscoveryResultCodec
>;
export type ScoutMatchProcessingResultEnvelope = EnvelopeOf<
  typeof scoutMatchProcessingResultCodec
>;
export type ScoutPrematchDiscoveryResultEnvelope = EnvelopeOf<
  typeof scoutPrematchDiscoveryResultCodec
>;
export type ScoutPrematchGameResultEnvelope = EnvelopeOf<
  typeof scoutPrematchGameResultCodec
>;
export type ScoutNotificationResultEnvelope = EnvelopeOf<
  typeof scoutNotificationResultCodec
>;
export type ScoutLakeProjectionResultEnvelope = EnvelopeOf<
  typeof scoutLakeProjectionResultCodec
>;
export type ScoutRecoveryBatchResultEnvelope = EnvelopeOf<
  typeof scoutRecoveryBatchResultCodec
>;
export type ScoutPipelineReconciliationResultEnvelope = EnvelopeOf<
  typeof scoutPipelineReconciliationResultCodec
>;
