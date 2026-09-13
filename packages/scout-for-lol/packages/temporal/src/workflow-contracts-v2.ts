import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  MatchProcessingPolicySchema,
  PipelineOwnerSchema,
  ReceiptKindSchema,
} from "@scout-for-lol/domain/match-processing/states.ts";
import { NotificationIntentStateSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  RecoveryBatchStateSchema,
  RecoveryCountsSchema,
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
 */
export const ScoutMatchProcessingV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  riotMatchId: RiotMatchIdSchema,
});
export type ScoutMatchProcessingV2Input = z.infer<
  typeof ScoutMatchProcessingV2InputSchema
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
 * The intent's state when the Workflow stopped driving it. `unknown-delivery`
 * is a legitimate stopping point and NOT a failure: the machine leaves it only
 * through an operator resolution, because a retry could double-deliver.
 */
export const ScoutNotificationV2ResultSchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  intentKey: ScoutNotificationIntentKeySchema,
  state: NotificationIntentStateSchema,
  attemptCount: z.int().nonnegative(),
});
export type ScoutNotificationV2Result = z.infer<
  typeof ScoutNotificationV2ResultSchema
>;

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
export const scoutMatchProcessingV2ResultCodec = defineVersionedCodec({
  kind: "scout-match-processing-v2-result",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutMatchProcessingV2ResultSchema,
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
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutNotificationV2ResultSchema,
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
