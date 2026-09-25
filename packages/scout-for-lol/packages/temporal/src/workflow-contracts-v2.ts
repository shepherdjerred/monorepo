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
  SCOUT_V2_CONTRACT_VERSION,
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
  ScoutRecoveryBatchIdSchema,
  ScoutV2TriggerSchema,
} from "./contracts-v2.ts";

/** The envelope type a codec produces, without restating its kind literal. */
type EnvelopeOf<
  Codec extends { readonly serialize: (value: never) => unknown },
> = ReturnType<Codec["serialize"]>;

// ─── V2 Workflow inputs ────────────────────────────────────────────────────

export const ScoutPostMatchDiscoveryV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  trigger: ScoutV2TriggerSchema,
});
export type ScoutPostMatchDiscoveryV2Input = z.infer<
  typeof ScoutPostMatchDiscoveryV2InputSchema
>;

/**
 * The per-match core is keyed by nothing but the match it processes.
 *
 * Spelled out rather than aliased to `ScoutMatchRefV2Schema`: the Workflow
 * input and the Activity reference happen to agree today, and a frozen
 * Workflow contract must not change because an Activity reference did.
 *
 * `sourcePuuid` is the tracked account whose match history surfaced this
 * match, when the run was started by discovery. It restores v1's
 * precondition — `ingestDiscoveredMatch` refuses a match whose discovering
 * account is no longer tracked — which `commitMatchObservationV2` checks
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
export const ScoutMatchProcessingV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  riotMatchId: RiotMatchIdSchema,
  sourcePuuid: LeaguePuuidSchema.optional(),
  deliveryMode: MatchDeliveryModeSchema.optional(),
});
export type ScoutMatchProcessingV2Input = z.infer<
  typeof ScoutMatchProcessingV2InputSchema
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
export const ScoutClientMatchDispatchItemV2Schema = z.strictObject({
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
export type ScoutClientMatchDispatchItemV2 = z.infer<
  typeof ScoutClientMatchDispatchItemV2Schema
>;

/** A signal is bounded by the native ingress batch limit. */
export const ScoutClientMatchDispatchBatchV2Schema = z
  .array(ScoutClientMatchDispatchItemV2Schema)
  .min(1)
  .max(100)
  .readonly();
export type ScoutClientMatchDispatchBatchV2 = z.infer<
  typeof ScoutClientMatchDispatchBatchV2Schema
>;

/**
 * Pending work crosses Continue-As-New so an accepted signal is never lost.
 * The larger bound permits a short burst from several clients while keeping
 * the Workflow payload well below Temporal's service limit.
 */
const ScoutClientMatchDispatchV1InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  pending: z.array(ScoutClientMatchDispatchItemV2Schema).max(5000).readonly(),
});

export const ScoutClientMatchDispatchOrderKeyV2Schema = z.strictObject({
  gameEndTimestamp: z.int().nonnegative(),
  riotMatchId: RiotMatchIdSchema,
});
export type ScoutClientMatchDispatchOrderKeyV2 = z.infer<
  typeof ScoutClientMatchDispatchOrderKeyV2Schema
>;

/**
 * `orderingWatermark` is the last match whose ordered processing began. A
 * newly arriving offline match that sorts before it can no longer be safely
 * settled, because effects for the watermark match may already be durable.
 * Such arrivals remain in `lateArrivals` until their review marker and exact
 * requester acknowledgement are both durable.
 */
export const ScoutClientMatchDispatchV2InputSchema = z
  .strictObject({
    stage: ScoutStageSchema,
    pending: z.array(ScoutClientMatchDispatchItemV2Schema).max(5000).readonly(),
    lateArrivals: z
      .array(ScoutClientMatchDispatchItemV2Schema)
      .max(5000)
      .readonly(),
    orderingWatermark: ScoutClientMatchDispatchOrderKeyV2Schema.nullable(),
  })
  .superRefine((input, context) => {
    if (input.pending.length + input.lateArrivals.length <= 5000) return;
    context.addIssue({
      code: "custom",
      message: "combined dispatcher queue exceeds 5000 matches",
      path: ["lateArrivals"],
    });
  });
export type ScoutClientMatchDispatchV2Input = z.infer<
  typeof ScoutClientMatchDispatchV2InputSchema
>;

/** Completion acknowledgement sent to the exact discovery run that waited. */
export const ScoutClientMatchDispatchResultV2Schema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  outcome: z.enum(["processed", "already-complete", "terminal-failure"]),
  failureType: z.string().min(1).max(160).optional(),
});
export type ScoutClientMatchDispatchResultV2 = z.infer<
  typeof ScoutClientMatchDispatchResultV2Schema
>;

export const ScoutPrematchDiscoveryV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
});
export type ScoutPrematchDiscoveryV2Input = z.infer<
  typeof ScoutPrematchDiscoveryV2InputSchema
>;

export const ScoutPrematchGameV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  gameRef: ScoutPrematchGameRefSchema,
});
export type ScoutPrematchGameV2Input = z.infer<
  typeof ScoutPrematchGameV2InputSchema
>;

export const ScoutNotificationV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  intentKey: ScoutNotificationIntentKeySchema,
});
export type ScoutNotificationV2Input = z.infer<
  typeof ScoutNotificationV2InputSchema
>;

export const ScoutLakeProjectionV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  riotMatchId: RiotMatchIdSchema,
});
export type ScoutLakeProjectionV2Input = z.infer<
  typeof ScoutLakeProjectionV2InputSchema
>;

/**
 * A recovery batch carries no cursor in its input, and that is deliberate.
 * The scan position, page budget and counts live in the durable batch row,
 * which is the whole reason the row exists: a Continue-As-New that re-serialized
 * them would give the batch two sources of truth that a crash between the
 * cursor write and the Continue-As-New could disagree about.
 */
export const ScoutRecoveryBatchV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  recoveryBatchId: ScoutRecoveryBatchIdSchema,
});
export type ScoutRecoveryBatchV2Input = z.infer<
  typeof ScoutRecoveryBatchV2InputSchema
>;

/**
 * Reconciliation likewise carries no cursor. Its scan is idempotent and
 * resumes from the durable watermark each run, so a Continue-As-New repeats
 * the input unchanged.
 */
export const ScoutPipelineReconciliationV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  trigger: ScoutV2TriggerSchema,
});
export type ScoutPipelineReconciliationV2Input = z.infer<
  typeof ScoutPipelineReconciliationV2InputSchema
>;

export const scoutPostMatchDiscoveryV2InputCodec = defineVersionedCodec({
  kind: "scout-post-match-discovery-v2-input",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutPostMatchDiscoveryV2InputSchema,
});
export const scoutMatchProcessingV2InputCodec = defineVersionedCodec({
  kind: "scout-match-processing-v2-input",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutMatchProcessingV2InputSchema,
});
export const SCOUT_CLIENT_MATCH_DISPATCH_V2_INPUT_VERSION = 2;

export const scoutClientMatchDispatchV2InputCodec = defineVersionedCodec({
  kind: "scout-client-match-dispatch-v2-input",
  version: SCOUT_CLIENT_MATCH_DISPATCH_V2_INPUT_VERSION,
  schema: ScoutClientMatchDispatchV2InputSchema,
  migrations: {
    1: (old) => ({
      ...ScoutClientMatchDispatchV1InputSchema.parse(old),
      lateArrivals: [],
      orderingWatermark: null,
    }),
  },
});
export const scoutPrematchDiscoveryV2InputCodec = defineVersionedCodec({
  kind: "scout-prematch-discovery-v2-input",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutPrematchDiscoveryV2InputSchema,
});
export const scoutPrematchGameV2InputCodec = defineVersionedCodec({
  kind: "scout-prematch-game-v2-input",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutPrematchGameV2InputSchema,
});
export const scoutNotificationV2InputCodec = defineVersionedCodec({
  kind: "scout-notification-v2-input",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutNotificationV2InputSchema,
});
export const scoutLakeProjectionV2InputCodec = defineVersionedCodec({
  kind: "scout-lake-projection-v2-input",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutLakeProjectionV2InputSchema,
});
export const scoutRecoveryBatchV2InputCodec = defineVersionedCodec({
  kind: "scout-recovery-batch-v2-input",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutRecoveryBatchV2InputSchema,
});
export const scoutPipelineReconciliationV2InputCodec = defineVersionedCodec({
  kind: "scout-pipeline-reconciliation-v2-input",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutPipelineReconciliationV2InputSchema,
});

export type ScoutPostMatchDiscoveryV2InputEnvelope = EnvelopeOf<
  typeof scoutPostMatchDiscoveryV2InputCodec
>;
export type ScoutMatchProcessingV2InputEnvelope = EnvelopeOf<
  typeof scoutMatchProcessingV2InputCodec
>;
export type ScoutClientMatchDispatchV2InputEnvelope = EnvelopeOf<
  typeof scoutClientMatchDispatchV2InputCodec
>;
export type ScoutPrematchDiscoveryV2InputEnvelope = EnvelopeOf<
  typeof scoutPrematchDiscoveryV2InputCodec
>;
export type ScoutPrematchGameV2InputEnvelope = EnvelopeOf<
  typeof scoutPrematchGameV2InputCodec
>;
export type ScoutNotificationV2InputEnvelope = EnvelopeOf<
  typeof scoutNotificationV2InputCodec
>;
export type ScoutLakeProjectionV2InputEnvelope = EnvelopeOf<
  typeof scoutLakeProjectionV2InputCodec
>;
export type ScoutRecoveryBatchV2InputEnvelope = EnvelopeOf<
  typeof scoutRecoveryBatchV2InputCodec
>;
export type ScoutPipelineReconciliationV2InputEnvelope = EnvelopeOf<
  typeof scoutPipelineReconciliationV2InputCodec
>;

// ─── V2 Workflow results ───────────────────────────────────────────────────

export const ScoutPostMatchDiscoveryV2ResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  discovered: z.int().nonnegative(),
  childrenStarted: z.int().nonnegative(),
  /** False when discovery could not see the whole tail of completed matches. */
  complete: z.boolean(),
});
export type ScoutPostMatchDiscoveryV2Result = z.infer<
  typeof ScoutPostMatchDiscoveryV2ResultSchema
>;

export const ScoutMatchProcessingV2ResultSchema = z.strictObject({
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
export type ScoutMatchProcessingV2Result = z.infer<
  typeof ScoutMatchProcessingV2ResultSchema
>;

export const ScoutPrematchDiscoveryV2ResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  discovered: z.int().nonnegative(),
  childrenStarted: z.int().nonnegative(),
  complete: z.boolean(),
});
export type ScoutPrematchDiscoveryV2Result = z.infer<
  typeof ScoutPrematchDiscoveryV2ResultSchema
>;

export const ScoutPrematchGameV2ResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  /** The match id the snapshot belongs to, composed from the game reference. */
  riotMatchId: RiotMatchIdSchema,
  receiptKinds: z.array(ReceiptKindSchema).readonly(),
  childrenStarted: z.strictObject({
    notifications: z.int().nonnegative(),
  }),
});
export type ScoutPrematchGameV2Result = z.infer<
  typeof ScoutPrematchGameV2ResultSchema
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
export const ScoutNotificationDispositionV2Schema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("driven") }),
    z.strictObject({
      kind: z.literal("held"),
      policy: RecoveryPolicySchema,
      target: NotificationTargetKindSchema,
    }),
  ],
);
export type ScoutNotificationDispositionV2 = z.infer<
  typeof ScoutNotificationDispositionV2Schema
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
export const ScoutNotificationV2ResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  intentKey: ScoutNotificationIntentKeySchema,
  state: NotificationIntentStateSchema,
  attemptCount: z.int().nonnegative(),
  disposition: ScoutNotificationDispositionV2Schema,
});
export type ScoutNotificationV2Result = z.infer<
  typeof ScoutNotificationV2ResultSchema
>;

export const SCOUT_NOTIFICATION_V2_RESULT_VERSION = 2;

export const ScoutLakeProjectionV2ResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  riotMatchId: RiotMatchIdSchema,
  receiptKinds: z.array(ReceiptKindSchema).readonly(),
  stagedFileCount: z.int().nonnegative(),
});
export type ScoutLakeProjectionV2Result = z.infer<
  typeof ScoutLakeProjectionV2ResultSchema
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
export const ScoutRecoveryCountsReportV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("observed"),
    counts: RecoveryCountsSchema,
  }),
  z.strictObject({ kind: z.literal("unobserved") }),
]);
export type ScoutRecoveryCountsReportV2 = z.infer<
  typeof ScoutRecoveryCountsReportV2Schema
>;

export const ScoutRecoveryBatchV2ResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  recoveryBatchId: ScoutRecoveryBatchIdSchema,
  state: RecoveryBatchStateSchema,
  counts: ScoutRecoveryCountsReportV2Schema,
});
export type ScoutRecoveryBatchV2Result = z.infer<
  typeof ScoutRecoveryBatchV2ResultSchema
>;

export const ScoutPipelineReconciliationV2ResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  trigger: ScoutV2TriggerSchema,
  pagesScanned: z.int().nonnegative(),
  childrenStarted: z.strictObject({
    matchProcessing: z.int().nonnegative(),
    notifications: z.int().nonnegative(),
    lakeProjections: z.int().nonnegative(),
    recoveryBatches: z.int().nonnegative(),
  }),
});
export type ScoutPipelineReconciliationV2Result = z.infer<
  typeof ScoutPipelineReconciliationV2ResultSchema
>;

export const scoutPostMatchDiscoveryV2ResultCodec = defineVersionedCodec({
  kind: "scout-post-match-discovery-v2-result",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutPostMatchDiscoveryV2ResultSchema,
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
export const SCOUT_MATCH_PROCESSING_V2_RESULT_VERSION = 2;

export const scoutMatchProcessingV2ResultCodec = defineVersionedCodec({
  kind: "scout-match-processing-v2-result",
  version: SCOUT_MATCH_PROCESSING_V2_RESULT_VERSION,
  schema: ScoutMatchProcessingV2ResultSchema,
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
export const scoutPrematchDiscoveryV2ResultCodec = defineVersionedCodec({
  kind: "scout-prematch-discovery-v2-result",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutPrematchDiscoveryV2ResultSchema,
});
export const scoutPrematchGameV2ResultCodec = defineVersionedCodec({
  kind: "scout-prematch-game-v2-result",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutPrematchGameV2ResultSchema,
});
export const scoutNotificationV2ResultCodec = defineVersionedCodec({
  kind: "scout-notification-v2-result",
  version: SCOUT_NOTIFICATION_V2_RESULT_VERSION,
  schema: ScoutNotificationV2ResultSchema,
  migrations: {
    1: (old) => ({
      ...z.record(z.string(), z.unknown()).parse(old),
      disposition: { kind: "driven" },
    }),
  },
});
export const scoutLakeProjectionV2ResultCodec = defineVersionedCodec({
  kind: "scout-lake-projection-v2-result",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutLakeProjectionV2ResultSchema,
});
export const scoutRecoveryBatchV2ResultCodec = defineVersionedCodec({
  kind: "scout-recovery-batch-v2-result",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutRecoveryBatchV2ResultSchema,
});
export const scoutPipelineReconciliationV2ResultCodec = defineVersionedCodec({
  kind: "scout-pipeline-reconciliation-v2-result",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutPipelineReconciliationV2ResultSchema,
});

export type ScoutPostMatchDiscoveryV2ResultEnvelope = EnvelopeOf<
  typeof scoutPostMatchDiscoveryV2ResultCodec
>;
export type ScoutMatchProcessingV2ResultEnvelope = EnvelopeOf<
  typeof scoutMatchProcessingV2ResultCodec
>;
export type ScoutPrematchDiscoveryV2ResultEnvelope = EnvelopeOf<
  typeof scoutPrematchDiscoveryV2ResultCodec
>;
export type ScoutPrematchGameV2ResultEnvelope = EnvelopeOf<
  typeof scoutPrematchGameV2ResultCodec
>;
export type ScoutNotificationV2ResultEnvelope = EnvelopeOf<
  typeof scoutNotificationV2ResultCodec
>;
export type ScoutLakeProjectionV2ResultEnvelope = EnvelopeOf<
  typeof scoutLakeProjectionV2ResultCodec
>;
export type ScoutRecoveryBatchV2ResultEnvelope = EnvelopeOf<
  typeof scoutRecoveryBatchV2ResultCodec
>;
export type ScoutPipelineReconciliationV2ResultEnvelope = EnvelopeOf<
  typeof scoutPipelineReconciliationV2ResultCodec
>;
