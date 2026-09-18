import { z } from "zod";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  DiscordMessageIdSchema,
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  MatchProcessingPolicySchema,
  PipelineOwnerSchema,
  ReceiptKindSchema,
} from "@scout-for-lol/domain/match-processing/states.ts";
import {
  NotificationFailureSchema,
  NotificationIntentKindSchema,
  NotificationIntentStateSchema,
  NotificationTargetKindSchema,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  RecoveryAbandonReasonSchema,
  RecoveryBatchStateSchema,
  RecoveryCountsSchema,
  RecoveryPolicySchema,
} from "@scout-for-lol/domain/recovery/batch.ts";
import {
  SCOUT_V2_PAGE_MAX,
  ScoutDurableCommitV2Schema,
  ScoutIntentAttemptRefV2Schema,
  ScoutMatchRefV2Schema,
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
  ScoutReceiptOutcomeV2Schema,
  ScoutRecoveryBatchIdSchema,
  ScoutRecoveryBatchRefV2Schema,
} from "./contracts-v2.ts";

// ─── V2 Activity contracts ─────────────────────────────────────────────────

/**
 * Activity payloads are flat and strict. Inputs carry identifiers and small
 * references; results carry domain state unions, repository outcomes, and
 * counts. These shapes are append-only: a lane that needs a breaking change
 * introduces a new Activity name rather than redefining one that in-flight
 * histories already recorded.
 */

/**
 * What a post-match discovery pass did, and it is a closed union on purpose.
 *
 * `skipped` is discovery refusing to run because a poll already holds
 * `BotState.pollStatus`. It opened NO poll: the status still belongs to the
 * other execution, and nothing this run does may close it. It is not an empty
 * scan — an empty scan opened a poll, saw nothing, and owes the maintenance
 * that closes it — and a boolean could not keep the two apart at the call site
 * that has to.
 */
export const ScoutPostMatchScanV2ResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({ outcome: z.literal("skipped") }),
    z.strictObject({
      outcome: z.literal("scanned"),
      riotMatchIds: z
        .array(RiotMatchIdSchema)
        .max(SCOUT_V2_PAGE_MAX)
        .readonly(),
      /** False when the scan hit its page budget before the tail was exhausted. */
      complete: z.boolean(),
      /**
       * The poll claim this scan opened, by the instant it was claimed at.
       *
       * Required on this branch because a scan that ran holds a claim by
       * construction, and the Workflow owes the close that releases it. The
       * value travels to maintenance and guards the close there, so a run
       * whose claim was taken over closes nothing and fails loudly instead of
       * marking a LATER run's poll complete underneath it. The instant is the
       * identity because it is the one value the claim and the close both
       * already carry.
       */
      pollOwner: IsoInstantSchema,
      /**
       * How far Dare evidence is known-complete, when the scan could
       * establish it.
       *
       * Carried so post-match maintenance can settle Dare deadlines against
       * the same watermark v1 settles against — the value is the discovery
       * pass's to compute and nothing downstream can recover it. Optional
       * because a scan that could not see the whole tail has no watermark to
       * offer, which is a different statement from a watermark of zero.
       */
      evidenceWatermark: IsoInstantSchema.optional(),
    }),
  ],
);
export type ScoutPostMatchScanV2Result = z.infer<
  typeof ScoutPostMatchScanV2ResultSchema
>;

export const ScoutPrematchScanV2ResultSchema = z.strictObject({
  games: z.array(ScoutPrematchGameRefSchema).max(SCOUT_V2_PAGE_MAX).readonly(),
  complete: z.boolean(),
});
export type ScoutPrematchScanV2Result = z.infer<
  typeof ScoutPrematchScanV2ResultSchema
>;

/**
 * One archived artifact. The descriptor names the stored bytes by key and
 * digest — a reference, never the payload — and `receipt` reports the durable
 * attestation separately from the store, because the object write and the
 * receipt row are two commits that cannot share a transaction.
 */
export const ScoutArchivedArtifactV2Schema = z.strictObject({
  descriptor: ArtifactDescriptorSchema,
  outcome: z.enum(["stored", "already-stored"]),
  receipt: ScoutReceiptOutcomeV2Schema,
});
export type ScoutArchivedArtifactV2 = z.infer<
  typeof ScoutArchivedArtifactV2Schema
>;

export const ScoutArchiveV2ResultSchema = z.strictObject({
  artifacts: z.array(ScoutArchivedArtifactV2Schema).readonly(),
});
export type ScoutArchiveV2Result = z.infer<typeof ScoutArchiveV2ResultSchema>;

export const ScoutPrematchArchiveV2ResultSchema =
  ScoutArchiveV2ResultSchema.extend({
    /** Composed from the game reference: Riot builds the same id later. */
    riotMatchId: RiotMatchIdSchema,
  });
export type ScoutPrematchArchiveV2Result = z.infer<
  typeof ScoutPrematchArchiveV2ResultSchema
>;

export const ScoutMatchObservationV2ResultSchema = z.strictObject({
  commit: ScoutDurableCommitV2Schema,
  owner: PipelineOwnerSchema,
  policy: MatchProcessingPolicySchema,
  promoted: z.boolean(),
});
export type ScoutMatchObservationV2Result = z.infer<
  typeof ScoutMatchObservationV2ResultSchema
>;

/**
 * A guarded at-most-once effect: settlement, progression, anything whose
 * second application would be visible.
 *
 * `guard` and `fact` are separate fields, not one outcome, because
 * `ScoutEffectClaim` takes the top-level Prisma client and so cannot enlist in
 * the transaction that writes the fact. A run that claimed the guard and
 * crashed before the fact leaves `guard: already-applied` with
 * `fact: applied` on the next attempt — the reconcile — and that has to be
 * reportable rather than indistinguishable from a double application.
 */
export const ScoutGuardedEffectV2ResultSchema = z.strictObject({
  guard: ScoutDurableCommitV2Schema,
  fact: ScoutDurableCommitV2Schema,
  /** How many domain records this run actually changed. */
  effects: z.int().nonnegative(),
});
export type ScoutGuardedEffectV2Result = z.infer<
  typeof ScoutGuardedEffectV2ResultSchema
>;

export const ScoutMatchReceiptsV2InputSchema = ScoutMatchRefV2Schema.extend({
  kinds: z.array(ReceiptKindSchema).min(1).max(SCOUT_V2_PAGE_MAX).readonly(),
});
export type ScoutMatchReceiptsV2Input = z.infer<
  typeof ScoutMatchReceiptsV2InputSchema
>;

export const ScoutReceiptsV2ResultSchema = z.strictObject({
  receipts: z.array(ScoutReceiptOutcomeV2Schema).readonly(),
});
export type ScoutReceiptsV2Result = z.infer<typeof ScoutReceiptsV2ResultSchema>;

/**
 * What the tournament-code finalization stage found and did.
 *
 * Tournament custom games and ordinary Riot match ingestion keep distinct
 * provenance, so this is its own stage with its own answer rather than a flag
 * on the observation: `not-a-tournament-match` is the ordinary case and says
 * so out loud, instead of being indistinguishable from a finalization that
 * happened to publish nothing.
 *
 * `publishedNight` reports the Custom Night snapshot broadcast, which is a
 * projection of current state rather than an event, so a resumed run that
 * republishes it changes nothing a client can observe twice.
 */
export const ScoutTournamentResultV2ResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({ outcome: z.literal("not-a-tournament-match") }),
    z.strictObject({
      outcome: z.literal("finalized"),
      publishedNight: z.boolean(),
    }),
    z.strictObject({
      outcome: z.literal("already-finalized"),
      publishedNight: z.boolean(),
    }),
  ],
);
export type ScoutTournamentResultV2Result = z.infer<
  typeof ScoutTournamentResultV2ResultSchema
>;

export const ScoutMatchCursorV2ResultSchema = z.strictObject({
  advanced: z.int().nonnegative(),
  alreadyAdvanced: z.int().nonnegative(),
});
export type ScoutMatchCursorV2Result = z.infer<
  typeof ScoutMatchCursorV2ResultSchema
>;

/**
 * What to start once the domain commit stands.
 *
 * The intent keys are READ from the durable intent rows for this match, never
 * derived per channel by the caller: a Workflow that guessed a key per channel
 * would miss intents another producer minted and would re-mint keys for
 * intents that already exist.
 */
export const ScoutFanOutV2ResultSchema = z.strictObject({
  notificationIntentKeys: z
    .array(ScoutNotificationIntentKeySchema)
    .max(SCOUT_V2_PAGE_MAX)
    .readonly(),
  lakeProjection: z.boolean(),
});
export type ScoutFanOutV2Result = z.infer<typeof ScoutFanOutV2ResultSchema>;

/** One intent, summarised in the domain's own state vocabulary. */
export const ScoutIntentSummaryV2Schema = z.strictObject({
  intentKey: ScoutNotificationIntentKeySchema,
  state: NotificationIntentStateSchema,
  attemptCount: z.int().nonnegative(),
  lastFailure: NotificationFailureSchema.optional(),
});
export type ScoutIntentSummaryV2 = z.infer<typeof ScoutIntentSummaryV2Schema>;

/**
 * The resume point for one match: the single aggregate read that tells a
 * restarted or Continue-As-New'd Workflow which phases already happened.
 *
 * It spans observation, receipts, intents and tracked accounts on purpose. A
 * Workflow that reconstructed this from per-key lookups would need to know the
 * intent keys before it could read them, which is exactly the thing it is
 * asking about.
 */
export const ScoutMatchPipelineStateV2Schema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  owner: PipelineOwnerSchema,
  policy: MatchProcessingPolicySchema,
  promoted: z.boolean(),
  receiptKinds: z.array(ReceiptKindSchema).readonly(),
  intents: z
    .array(ScoutIntentSummaryV2Schema)
    .max(SCOUT_V2_PAGE_MAX)
    .readonly(),
  trackedAccounts: z.strictObject({
    total: z.int().nonnegative(),
    cursorAdvanced: z.int().nonnegative(),
  }),
});
export type ScoutMatchPipelineStateV2 = z.infer<
  typeof ScoutMatchPipelineStateV2Schema
>;

export const ScoutMatchPipelineStateV2ResultSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("absent") }),
    z.strictObject({
      kind: z.literal("present"),
      state: ScoutMatchPipelineStateV2Schema,
    }),
  ],
);
export type ScoutMatchPipelineStateV2Result = z.infer<
  typeof ScoutMatchPipelineStateV2ResultSchema
>;

/**
 * Whether one intent may be sent right now, and why.
 *
 * `policy` is the recovery policy the intent is delivered under — `normal`
 * for a live-born intent, the batch's own for a recovery-born one, read from
 * the batch row at the moment of the read so an operator release on the
 * batch is seen by the next run. `decision` is the pure domain rule
 * (`notificationDeliveryDecision`) applied to that policy and the target's
 * kind; `kind` says what the intent announces, which is what selects its
 * renderer. All four travel so a Workflow history explains itself.
 */
export const ScoutNotificationGateV2Schema = z.strictObject({
  kind: NotificationIntentKindSchema,
  target: NotificationTargetKindSchema,
  policy: RecoveryPolicySchema,
  decision: z.enum(["permitted", "held"]),
});
export type ScoutNotificationGateV2 = z.infer<
  typeof ScoutNotificationGateV2Schema
>;

export const ScoutNotificationIntentV2ResultSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("absent") }),
    z.strictObject({
      kind: z.literal("present"),
      intent: ScoutIntentSummaryV2Schema,
      gate: ScoutNotificationGateV2Schema,
    }),
  ],
);
export type ScoutNotificationIntentV2Result = z.infer<
  typeof ScoutNotificationIntentV2ResultSchema
>;

/**
 * The resume point for one recovery batch: exactly what the durable row
 * retains, and nothing reconstructed.
 *
 * Counts are deliberately not a field here. The row flattens the state union
 * and holds count columns only while the batch is `processing`, so `state`
 * already carries the tally when — and only when — one exists. A separate
 * counts field would have to be empty for every batch past processing, which
 * is the same fact stated twice and an invitation to fill it in. A workflow
 * resumed past processing reports `ScoutRecoveryCountsReportV2`'s
 * `unobserved` instead.
 */
export const ScoutRecoveryBatchStateV2ResultSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("absent") }),
    z.strictObject({
      kind: z.literal("present"),
      policy: RecoveryPolicySchema,
      state: RecoveryBatchStateSchema,
    }),
  ],
);
export type ScoutRecoveryBatchStateV2Result = z.infer<
  typeof ScoutRecoveryBatchStateV2ResultSchema
>;

export const ScoutNotificationTransitionV2ResultSchema = z.strictObject({
  commit: ScoutDurableCommitV2Schema,
  state: NotificationIntentStateSchema,
  attemptCount: z.int().nonnegative(),
});
export type ScoutNotificationTransitionV2Result = z.infer<
  typeof ScoutNotificationTransitionV2ResultSchema
>;

/** Rendering reuses committed output; `reused` means nothing was re-rendered. */
export const ScoutNotificationRenderV2ResultSchema = z.strictObject({
  outcome: z.enum(["rendered", "reused"]),
});
export type ScoutNotificationRenderV2Result = z.infer<
  typeof ScoutNotificationRenderV2ResultSchema
>;

/**
 * What the send attempt observed. `unknown` is not a failure and must never
 * be turned into one: the request left, the response did not arrive, and only
 * an operator can decide whether a message exists.
 */
export const ScoutNotificationDeliveryV2ResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      outcome: z.literal("delivered"),
      messageId: DiscordMessageIdSchema.optional(),
    }),
    z.strictObject({
      outcome: z.literal("failed"),
      failure: NotificationFailureSchema,
    }),
    z.strictObject({ outcome: z.literal("unknown") }),
  ],
);
export type ScoutNotificationDeliveryV2Result = z.infer<
  typeof ScoutNotificationDeliveryV2ResultSchema
>;

export const ScoutNotificationOutcomeV2InputSchema =
  ScoutIntentAttemptRefV2Schema.extend({
    delivery: ScoutNotificationDeliveryV2ResultSchema,
  });
export type ScoutNotificationOutcomeV2Input = z.infer<
  typeof ScoutNotificationOutcomeV2InputSchema
>;

export const ScoutLakeStagingV2ResultSchema = z.strictObject({
  receipts: z.array(ScoutReceiptOutcomeV2Schema).readonly(),
  stagedFileCount: z.int().nonnegative(),
});
export type ScoutLakeStagingV2Result = z.infer<
  typeof ScoutLakeStagingV2ResultSchema
>;

export const ScoutRecoveryScanV2ResultSchema = z.strictObject({
  commit: ScoutDurableCommitV2Schema,
  state: RecoveryBatchStateSchema,
  discovered: z.int().nonnegative(),
  /** True once the scan is done, whether exhausted or budget-capped. */
  complete: z.boolean(),
});
export type ScoutRecoveryScanV2Result = z.infer<
  typeof ScoutRecoveryScanV2ResultSchema
>;

export const ScoutRecoveryProcessV2ResultSchema = z.strictObject({
  commit: ScoutDurableCommitV2Schema,
  state: RecoveryBatchStateSchema,
  counts: RecoveryCountsSchema,
  complete: z.boolean(),
});
export type ScoutRecoveryProcessV2Result = z.infer<
  typeof ScoutRecoveryProcessV2ResultSchema
>;

export const ScoutRecoveryTransitionV2ResultSchema = z.strictObject({
  commit: ScoutDurableCommitV2Schema,
  state: RecoveryBatchStateSchema,
});
export type ScoutRecoveryTransitionV2Result = z.infer<
  typeof ScoutRecoveryTransitionV2ResultSchema
>;

export const ScoutRecoveryCloseV2InputSchema =
  ScoutRecoveryBatchRefV2Schema.extend({
    close: z.discriminatedUnion("outcome", [
      z.strictObject({ outcome: z.literal("complete") }),
      z.strictObject({
        outcome: z.literal("abandoned"),
        reason: RecoveryAbandonReasonSchema,
      }),
    ]),
  });
export type ScoutRecoveryCloseV2Input = z.infer<
  typeof ScoutRecoveryCloseV2InputSchema
>;

/** One bounded reconciliation page: what it found that nothing is driving. */
export const ScoutReconciliationScanV2ResultSchema = z.strictObject({
  complete: z.boolean(),
  pending: z.strictObject({
    matchProcessing: z
      .array(RiotMatchIdSchema)
      .max(SCOUT_V2_PAGE_MAX)
      .readonly(),
    notifications: z
      .array(ScoutNotificationIntentKeySchema)
      .max(SCOUT_V2_PAGE_MAX)
      .readonly(),
    lakeProjections: z
      .array(RiotMatchIdSchema)
      .max(SCOUT_V2_PAGE_MAX)
      .readonly(),
    recoveryBatches: z
      .array(ScoutRecoveryBatchIdSchema)
      .max(SCOUT_V2_PAGE_MAX)
      .readonly(),
  }),
});
export type ScoutReconciliationScanV2Result = z.infer<
  typeof ScoutReconciliationScanV2ResultSchema
>;
