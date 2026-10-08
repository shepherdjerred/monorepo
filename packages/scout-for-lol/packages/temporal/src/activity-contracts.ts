import { z } from "zod";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  DiscordMessageIdSchema,
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
  SCOUT_PAGE_MAX,
  ScoutDurableCommitSchema,
  ScoutIntentAttemptRefSchema,
  ScoutMatchRefSchema,
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
  ScoutReceiptOutcomeSchema,
  ScoutRecoveryBatchIdSchema,
  ScoutRecoveryBatchRefSchema,
} from "./pipeline-contracts.ts";
import { ScoutSuppressedNotificationDeliverySchema } from "./notification-suppression-result.ts";

// ─── V2 Activity contracts ─────────────────────────────────────────────────

/**
 * Activity payloads are flat and strict. Inputs carry identifiers and small
 * references; results carry domain state unions, repository outcomes, and
 * counts. These shapes are append-only: a lane that needs a breaking change
 * introduces a new Activity name rather than redefining one that in-flight
 * histories already recorded.
 */

/**
 * One discovered match and the tracked account whose history surfaced it.
 *
 * The source travels with the id because the per-match core needs it for
 * v1's precondition (see `ScoutMatchProcessingInputSchema`), and only the
 * discovery pass knows it: v1's intents carry it, and nothing downstream can
 * recover which of a match's tracked participants was the one polled.
 */
export const ScoutDiscoveredMatchSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  sourcePuuid: LeaguePuuidSchema,
  /**
   * Whether this match is owed a public delivery, decided by the pass that
   * found it and by nothing downstream.
   *
   * v1 decides it per discovered match — a match surfaced while filling a gap
   * is `silent-backfill` and announces nothing — and only the discovery pass
   * holds the evidence for that call. Carried so the per-match run commits the
   * mode as a durable fact instead of re-deciding it, and so a restart reads
   * back what was decided rather than guessing.
   */
  deliveryMode: MatchDeliveryModeSchema,
  /**
   * Completion time used by the shared post-match serializer.
   *
   * Optional only for replay: histories recorded before the shared
   * dispatcher existed do not contain it and keep their original direct-child
   * path. Every newly produced discovery result carries it.
   */
  gameEndTimestamp: z.int().nonnegative().optional(),
});
export type ScoutDiscoveredMatch = z.infer<typeof ScoutDiscoveredMatchSchema>;

/**
 * What a post-match discovery pass did, and it is a closed union on purpose.
 *
 * `skipped` is discovery refusing to run because a poll already holds
 * `BotState.pollStatus`. It opened NO poll: the status still belongs to the
 * other execution, and nothing this run does may close it. It is not an empty
 * scan — an empty scan opened a poll, saw nothing, and owes the maintenance
 * that closes it — and a boolean could not keep the two apart at the call site
 * that has to.
 *
 * A scan carries `matches` beside `riotMatchIds`: additive, since older
 * histories recorded the ids alone, and the refinement keeps the two from
 * ever disagreeing about which matches this page holds or in what order.
 */
export const ScoutPostMatchScanResultSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({ outcome: z.literal("skipped") }),
    z.strictObject({
      outcome: z.literal("scanned"),
      riotMatchIds: z.array(RiotMatchIdSchema).max(SCOUT_PAGE_MAX).readonly(),
      /** The same page, with each match's discovering account. */
      matches: z
        .array(ScoutDiscoveredMatchSchema)
        .max(SCOUT_PAGE_MAX)
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
  ])
  .refine(
    (scan) =>
      scan.outcome === "skipped" ||
      (scan.matches.length === scan.riotMatchIds.length &&
        scan.matches.every(
          (match, index) => match.riotMatchId === scan.riotMatchIds[index],
        )),
    {
      message:
        "`matches` must name exactly the matches in `riotMatchIds`, in the same order",
      path: ["matches"],
    },
  );
export type ScoutPostMatchScanResult = z.infer<
  typeof ScoutPostMatchScanResultSchema
>;

export const ScoutPrematchScanResultSchema = z.strictObject({
  games: z.array(ScoutPrematchGameRefSchema).max(SCOUT_PAGE_MAX).readonly(),
  complete: z.boolean(),
});
export type ScoutPrematchScanResult = z.infer<
  typeof ScoutPrematchScanResultSchema
>;

/**
 * One archived artifact. The descriptor names the stored bytes by key and
 * digest — a reference, never the payload — and `receipt` reports the durable
 * attestation separately from the store, because the object write and the
 * receipt row are two commits that cannot share a transaction.
 */
export const ScoutArchivedArtifactSchema = z.strictObject({
  descriptor: ArtifactDescriptorSchema,
  outcome: z.enum(["stored", "already-stored"]),
  receipt: ScoutReceiptOutcomeSchema,
});
export type ScoutArchivedArtifact = z.infer<typeof ScoutArchivedArtifactSchema>;

export const ScoutArchiveResultSchema = z.strictObject({
  artifacts: z.array(ScoutArchivedArtifactSchema).readonly(),
});
export type ScoutArchiveResult = z.infer<typeof ScoutArchiveResultSchema>;

export const ScoutPrematchArchiveResultSchema = ScoutArchiveResultSchema.extend(
  {
    /** Composed from the game reference: Riot builds the same id later. */
    riotMatchId: RiotMatchIdSchema,
  },
);
export type ScoutPrematchArchiveResult = z.infer<
  typeof ScoutPrematchArchiveResultSchema
>;

/**
 * The observation commit's input: the match, plus the discovering account and
 * the delivery mode when the run has them. See
 * `ScoutMatchProcessingInputSchema` for why both are optional and what their
 * absence means.
 */
export const ScoutMatchObservationInputSchema = ScoutMatchRefSchema.extend({
  sourcePuuid: LeaguePuuidSchema.optional(),
  deliveryMode: MatchDeliveryModeSchema.optional(),
});
export type ScoutMatchObservationInput = z.infer<
  typeof ScoutMatchObservationInputSchema
>;

export const ScoutMatchObservationResultSchema = z.strictObject({
  commit: ScoutDurableCommitSchema,
  owner: PipelineOwnerSchema,
  policy: MatchProcessingPolicySchema,
  /**
   * The mode now STANDING on the row, read back after the commit, exactly as
   * `owner` and `policy` are. A run whose input disagreed with the stored mode
   * never reaches here — a differing mode is part of the observation claim and
   * comes back `observation-differs` — so this is the committed fact and the
   * only thing downstream may decide delivery from.
   */
  deliveryMode: MatchDeliveryModeSchema,
  promoted: z.boolean(),
});
export type ScoutMatchObservationResult = z.infer<
  typeof ScoutMatchObservationResultSchema
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
export const ScoutGuardedEffectResultSchema = z.strictObject({
  guard: ScoutDurableCommitSchema,
  fact: ScoutDurableCommitSchema,
  /** How many domain records this run actually changed. */
  effects: z.int().nonnegative(),
});
export type ScoutGuardedEffectResult = z.infer<
  typeof ScoutGuardedEffectResultSchema
>;

export const ScoutMatchReceiptsInputSchema = ScoutMatchRefSchema.extend({
  kinds: z.array(ReceiptKindSchema).min(1).max(SCOUT_PAGE_MAX).readonly(),
});
export type ScoutMatchReceiptsInput = z.infer<
  typeof ScoutMatchReceiptsInputSchema
>;

export const ScoutReceiptsResultSchema = z.strictObject({
  receipts: z.array(ScoutReceiptOutcomeSchema).readonly(),
});
export type ScoutReceiptsResult = z.infer<typeof ScoutReceiptsResultSchema>;

/**
 * What the managed-custom finalization stage found and did.
 *
 * The schema and its legacy `not-a-tournament-match` discriminator are frozen
 * because existing Temporal histories contain them. New games are bound from
 * local observations; historical Tournament API rows remain readable.
 *
 * `publishedNight` reports the Custom Night snapshot broadcast, which is a
 * projection of current state rather than an event, so a resumed run that
 * republishes it changes nothing a client can observe twice.
 */
export const ScoutTournamentResultResultSchema = z.discriminatedUnion(
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
export type ScoutTournamentResultResult = z.infer<
  typeof ScoutTournamentResultResultSchema
>;

/**
 * What one post-match minting pass did.
 *
 * `silent` is counted rather than folded into a zero, because "this match is
 * owed no public delivery" and "this match had no subscribed channel" are
 * different facts and a result envelope that reported both as nothing minted
 * could not tell an operator which happened.
 */
export const ScoutMintedIntentsResultSchema = z.strictObject({
  minted: z.int().nonnegative(),
  existing: z.int().nonnegative(),
  conflicts: z.int().nonnegative(),
  silent: z.int().nonnegative(),
});
export type ScoutMintedIntentsResult = z.infer<
  typeof ScoutMintedIntentsResultSchema
>;

export const ScoutMatchCursorResultSchema = z.strictObject({
  advanced: z.int().nonnegative(),
  alreadyAdvanced: z.int().nonnegative(),
});
export type ScoutMatchCursorResult = z.infer<
  typeof ScoutMatchCursorResultSchema
>;

/**
 * What to start once the domain commit stands.
 *
 * The intent keys are READ from the durable intent rows for this match, never
 * derived per channel by the caller: a Workflow that guessed a key per channel
 * would miss intents another producer minted and would re-mint keys for
 * intents that already exist.
 */
export const ScoutFanOutResultSchema = z.strictObject({
  notificationIntentKeys: z
    .array(ScoutNotificationIntentKeySchema)
    .max(SCOUT_PAGE_MAX)
    .readonly(),
  lakeProjection: z.boolean(),
});
export type ScoutFanOutResult = z.infer<typeof ScoutFanOutResultSchema>;

/** One intent, summarised in the domain's own state vocabulary. */
export const ScoutIntentSummarySchema = z.strictObject({
  intentKey: ScoutNotificationIntentKeySchema,
  state: NotificationIntentStateSchema,
  attemptCount: z.int().nonnegative(),
  lastFailure: NotificationFailureSchema.optional(),
});
export type ScoutIntentSummary = z.infer<typeof ScoutIntentSummarySchema>;

/**
 * The resume point for one match: the single aggregate read that tells a
 * restarted or Continue-As-New'd Workflow which phases already happened.
 *
 * It spans observation, receipts, intents and tracked accounts on purpose. A
 * Workflow that reconstructed this from per-key lookups would need to know the
 * intent keys before it could read them, which is exactly the thing it is
 * asking about.
 */
export const ScoutMatchPipelineStateSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  owner: PipelineOwnerSchema,
  policy: MatchProcessingPolicySchema,
  /** The committed delivery mode, so a restart takes it instead of deciding. */
  deliveryMode: MatchDeliveryModeSchema,
  promoted: z.boolean(),
  receiptKinds: z.array(ReceiptKindSchema).readonly(),
  intents: z.array(ScoutIntentSummarySchema).max(SCOUT_PAGE_MAX).readonly(),
  trackedAccounts: z.strictObject({
    total: z.int().nonnegative(),
    cursorAdvanced: z.int().nonnegative(),
  }),
});
export type ScoutMatchPipelineState = z.infer<
  typeof ScoutMatchPipelineStateSchema
>;

export const ScoutMatchPipelineStateResultSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("absent") }),
    // A terminal dispatcher receipt can predate the observation when a child
    // fails its source-account precondition. Keep that durable state distinct
    // from both an unstarted match and a complete pipeline aggregate.
    z.strictObject({ kind: z.literal("terminal") }),
    z.strictObject({
      kind: z.literal("present"),
      state: ScoutMatchPipelineStateSchema,
    }),
  ],
);
export type ScoutMatchPipelineStateResult = z.infer<
  typeof ScoutMatchPipelineStateResultSchema
>;

/**
 * Whether a match the retired v1 pipeline owned has finished.
 *
 * Every v1 execution has drained, so the backend now answers `completed`
 * unconditionally. The Activity and its result stay because open histories
 * recorded the read.
 */
export const ScoutLegacyMatchCompletionV2ResultSchema = z.strictObject({
  completed: z.boolean(),
});
export type ScoutLegacyMatchCompletionV2Result = z.infer<
  typeof ScoutLegacyMatchCompletionV2ResultSchema
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
export const ScoutNotificationGateSchema = z.strictObject({
  kind: NotificationIntentKindSchema,
  target: NotificationTargetKindSchema,
  policy: RecoveryPolicySchema,
  decision: z.enum(["permitted", "held"]),
});
export type ScoutNotificationGate = z.infer<typeof ScoutNotificationGateSchema>;

export const ScoutNotificationIntentResultSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("absent") }),
    z.strictObject({
      kind: z.literal("present"),
      intent: ScoutIntentSummarySchema,
      gate: ScoutNotificationGateSchema,
    }),
  ],
);
export type ScoutNotificationIntentResult = z.infer<
  typeof ScoutNotificationIntentResultSchema
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
 * resumed past processing reports `ScoutRecoveryCountsReport`'s
 * `unobserved` instead.
 */
export const ScoutRecoveryBatchStateResultSchema = z.discriminatedUnion(
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
export type ScoutRecoveryBatchStateResult = z.infer<
  typeof ScoutRecoveryBatchStateResultSchema
>;

export const ScoutNotificationTransitionResultSchema = z.strictObject({
  commit: ScoutDurableCommitSchema,
  state: NotificationIntentStateSchema,
  attemptCount: z.int().nonnegative(),
});
export type ScoutNotificationTransitionResult = z.infer<
  typeof ScoutNotificationTransitionResultSchema
>;

/** Rendering reuses committed output; `reused` means nothing was re-rendered. */
export const ScoutNotificationRenderResultSchema = z.strictObject({
  outcome: z.enum(["rendered", "reused"]),
});
export type ScoutNotificationRenderResult = z.infer<
  typeof ScoutNotificationRenderResultSchema
>;

/**
 * What the send attempt observed. `unknown` is not a failure and must never
 * be turned into one: the request left, the response did not arrive, and only
 * an operator can decide whether a message exists.
 */
export const ScoutNotificationDeliveryResultSchema = z.discriminatedUnion(
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
    ScoutSuppressedNotificationDeliverySchema,
    z.strictObject({ outcome: z.literal("unknown") }),
  ],
);
export type ScoutNotificationDeliveryResult = z.infer<
  typeof ScoutNotificationDeliveryResultSchema
>;

/**
 * The delivery Activity's timing contract, in one place because three things
 * depend on it agreeing with itself: the Workflow's Activity options, the
 * Activity's own pre-send budget, and the reasoning that says a timeout means
 * an ambiguous send.
 *
 * `deliverNotification` runs with `maximumAttempts: 1` because a retry can
 * double-deliver, so any failure the Workflow cannot attribute is recorded as
 * `unknown-delivery` — an operator dead end. That is the right answer for the
 * Discord request itself and the wrong answer for everything the Activity does
 * BEFORE it: a receipt read, an object fetch and a guild lookup provably send
 * nothing, and a server-side timeout during them would park a notification
 * that never left.
 *
 * So the Activity decides its own pre-send failures inside a budget strictly
 * shorter than the timeouts that would otherwise decide them for it. Whatever
 * has not finished preparing by then comes back as a definite, retryable
 * non-send while the Activity is still alive to say so, and only the Discord
 * call is ever left to the server's clock.
 */
export const NOTIFICATION_DELIVERY_START_TO_CLOSE_MS = 30_000;
export const NOTIFICATION_DELIVERY_HEARTBEAT_TIMEOUT_MS = 10_000;
export const NOTIFICATION_PRE_SEND_BUDGET_MS = 6000;

export const ScoutNotificationOutcomeInputSchema =
  ScoutIntentAttemptRefSchema.extend({
    delivery: ScoutNotificationDeliveryResultSchema,
  });
export type ScoutNotificationOutcomeInput = z.infer<
  typeof ScoutNotificationOutcomeInputSchema
>;

/**
 * What the post-delivery follow-up did. Best-effort by construction: it runs
 * only after the delivery outcome is durably recorded, so nothing it reports
 * can change what was delivered — `failed` is a log line with a return type,
 * not a signal to retry the send.
 */
export const ScoutNotificationFollowUpResultSchema = z.strictObject({
  outcome: z.enum(["completed", "skipped", "failed"]),
});
export type ScoutNotificationFollowUpResult = z.infer<
  typeof ScoutNotificationFollowUpResultSchema
>;

export const ScoutLakeStagingResultSchema = z.strictObject({
  receipts: z.array(ScoutReceiptOutcomeSchema).readonly(),
  stagedFileCount: z.int().nonnegative(),
});
export type ScoutLakeStagingResult = z.infer<
  typeof ScoutLakeStagingResultSchema
>;

export const ScoutRecoveryScanResultSchema = z.strictObject({
  commit: ScoutDurableCommitSchema,
  state: RecoveryBatchStateSchema,
  discovered: z.int().nonnegative(),
  /** True once the scan is done, whether exhausted or budget-capped. */
  complete: z.boolean(),
});
export type ScoutRecoveryScanResult = z.infer<
  typeof ScoutRecoveryScanResultSchema
>;

export const ScoutRecoveryProcessResultSchema = z.strictObject({
  commit: ScoutDurableCommitSchema,
  state: RecoveryBatchStateSchema,
  counts: RecoveryCountsSchema,
  complete: z.boolean(),
});
export type ScoutRecoveryProcessResult = z.infer<
  typeof ScoutRecoveryProcessResultSchema
>;

export const ScoutRecoveryTransitionResultSchema = z.strictObject({
  commit: ScoutDurableCommitSchema,
  state: RecoveryBatchStateSchema,
});
export type ScoutRecoveryTransitionResult = z.infer<
  typeof ScoutRecoveryTransitionResultSchema
>;

export const ScoutRecoveryCloseInputSchema = ScoutRecoveryBatchRefSchema.extend(
  {
    close: z.discriminatedUnion("outcome", [
      z.strictObject({ outcome: z.literal("complete") }),
      z.strictObject({
        outcome: z.literal("abandoned"),
        reason: RecoveryAbandonReasonSchema,
      }),
    ]),
  },
);
export type ScoutRecoveryCloseInput = z.infer<
  typeof ScoutRecoveryCloseInputSchema
>;

/** One bounded reconciliation page: what it found that nothing is driving. */
export const ScoutReconciliationScanResultSchema = z.strictObject({
  complete: z.boolean(),
  pending: z.strictObject({
    matchProcessing: z.array(RiotMatchIdSchema).max(SCOUT_PAGE_MAX).readonly(),
    notifications: z
      .array(ScoutNotificationIntentKeySchema)
      .max(SCOUT_PAGE_MAX)
      .readonly(),
    lakeProjections: z.array(RiotMatchIdSchema).max(SCOUT_PAGE_MAX).readonly(),
    recoveryBatches: z
      .array(ScoutRecoveryBatchIdSchema)
      .max(SCOUT_PAGE_MAX)
      .readonly(),
  }),
});
export type ScoutReconciliationScanResult = z.infer<
  typeof ScoutReconciliationScanResultSchema
>;
