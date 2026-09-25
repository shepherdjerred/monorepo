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
import { ScoutStageSchema } from "./contracts.ts";

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
 * v1's precondition (see `ScoutMatchProcessingV2InputSchema`), and only the
 * discovery pass knows it: v1's intents carry it, and nothing downstream can
 * recover which of a match's tracked participants was the one polled.
 */
export const ScoutDiscoveredMatchV2Schema = z.strictObject({
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
export type ScoutDiscoveredMatchV2 = z.infer<
  typeof ScoutDiscoveredMatchV2Schema
>;

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
export const ScoutPostMatchScanV2ResultSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({ outcome: z.literal("skipped") }),
    z.strictObject({
      outcome: z.literal("scanned"),
      riotMatchIds: z
        .array(RiotMatchIdSchema)
        .max(SCOUT_V2_PAGE_MAX)
        .readonly(),
      /** The same page, with each match's discovering account. */
      matches: z
        .array(ScoutDiscoveredMatchV2Schema)
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

/**
 * The observation commit's input: the match, plus the discovering account and
 * the delivery mode when the run has them. See
 * `ScoutMatchProcessingV2InputSchema` for why both are optional and what their
 * absence means.
 */
export const ScoutMatchObservationV2InputSchema = ScoutMatchRefV2Schema.extend({
  sourcePuuid: LeaguePuuidSchema.optional(),
  deliveryMode: MatchDeliveryModeSchema.optional(),
});
export type ScoutMatchObservationV2Input = z.infer<
  typeof ScoutMatchObservationV2InputSchema
>;

export const ScoutMatchObservationV2ResultSchema = z.strictObject({
  commit: ScoutDurableCommitV2Schema,
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

/**
 * What one post-match minting pass did.
 *
 * `silent` is counted rather than folded into a zero, because "this match is
 * owed no public delivery" and "this match had no subscribed channel" are
 * different facts and a result envelope that reported both as nothing minted
 * could not tell an operator which happened.
 */
export const ScoutMintedIntentsV2ResultSchema = z.strictObject({
  minted: z.int().nonnegative(),
  existing: z.int().nonnegative(),
  conflicts: z.int().nonnegative(),
  silent: z.int().nonnegative(),
});
export type ScoutMintedIntentsV2Result = z.infer<
  typeof ScoutMintedIntentsV2ResultSchema
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
  /** The committed delivery mode, so a restart takes it instead of deciding. */
  deliveryMode: MatchDeliveryModeSchema,
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
    // A terminal dispatcher receipt can predate the observation when a child
    // fails its source-account precondition. Keep that durable state distinct
    // from both an unstarted match and a complete pipeline aggregate.
    z.strictObject({ kind: z.literal("terminal") }),
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
 * The authoritative terminal state of a legacy match execution.
 *
 * Legacy durable receipts are deliberately fail-open, so they cannot prove
 * that the owning Workflow finished. The execution itself can: v1 completes
 * only after its effects and account cursors have been applied.
 */
export const ScoutLegacyMatchCompletionV2ResultSchema = z.strictObject({
  completed: z.boolean(),
});
export type ScoutLegacyMatchCompletionV2Result = z.infer<
  typeof ScoutLegacyMatchCompletionV2ResultSchema
>;

/**
 * Which pipeline owns this post-match discovery pass.
 *
 * `run-v2` is the V2 pass. `delegate-v1` hands the pass to v1's
 * `scoutPostMatchDiscoveryWorkflow`, and it is only returned once the
 * handoff has taken the same durable poll claim V2 discovery takes.
 * `pollOwner` names that claim: the v1 child runs under it and its
 * maintenance closes it. Taking the claim is one guarded statement, so two
 * overlapping handoffs, or a handoff and a V2 run, cannot both own the pass.
 * `defer-v1` means v1 owns discovery but another run holds the claim. The
 * pass stops and the next tick decides again.
 */
export const ScoutPostMatchDiscoveryOwnerV2ResultSchema = z.discriminatedUnion(
  "decision",
  [
    z.strictObject({ decision: z.literal("run-v2") }),
    z.strictObject({
      decision: z.literal("delegate-v1"),
      pollOwner: IsoInstantSchema,
    }),
    z.strictObject({
      decision: z.literal("defer-v1"),
      /** When the claim that still holds the row was taken, if the row says. */
      pollHeldSince: IsoInstantSchema.nullable(),
    }),
  ],
);
export type ScoutPostMatchDiscoveryOwnerV2Result = z.infer<
  typeof ScoutPostMatchDiscoveryOwnerV2ResultSchema
>;

/**
 * Whether releasing a delegated v1 pass's poll claim closed anything.
 *
 * `not-held` is an answer, not a fault: the v1 child's own maintenance, or
 * its discovery's failure path, already closed the claim.
 */
export const ScoutPostMatchPollReleaseV2ResultSchema = z.strictObject({
  outcome: z.enum(["released", "not-held"]),
});
export type ScoutPostMatchPollReleaseV2Result = z.infer<
  typeof ScoutPostMatchPollReleaseV2ResultSchema
>;

/**
 * Whether renewing a delegated v1 pass's poll claim kept it live.
 *
 * `not-held` means the claim was already closed or taken over, so there is
 * nothing left to keep live.
 */
export const ScoutPostMatchPollRenewalV2ResultSchema = z.strictObject({
  outcome: z.enum(["renewed", "not-held"]),
});
export type ScoutPostMatchPollRenewalV2Result = z.infer<
  typeof ScoutPostMatchPollRenewalV2ResultSchema
>;

/**
 * The claim a delegated v1 pass runs under: renewed while the pass runs, and
 * released when it fails.
 */
export const ScoutPostMatchPollReleaseV2InputSchema = z.strictObject({
  stage: ScoutStageSchema,
  pollOwner: IsoInstantSchema,
});
export type ScoutPostMatchPollReleaseV2Input = z.infer<
  typeof ScoutPostMatchPollReleaseV2InputSchema
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

/**
 * The delivery Activity's timing contract, in one place because three things
 * depend on it agreeing with itself: the Workflow's Activity options, the
 * Activity's own pre-send budget, and the reasoning that says a timeout means
 * an ambiguous send.
 *
 * `deliverNotificationV2` runs with `maximumAttempts: 1` because a retry can
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

export const ScoutNotificationOutcomeV2InputSchema =
  ScoutIntentAttemptRefV2Schema.extend({
    delivery: ScoutNotificationDeliveryV2ResultSchema,
  });
export type ScoutNotificationOutcomeV2Input = z.infer<
  typeof ScoutNotificationOutcomeV2InputSchema
>;

/**
 * What the post-delivery follow-up did. Best-effort by construction: it runs
 * only after the delivery outcome is durably recorded, so nothing it reports
 * can change what was delivered — `failed` is a log line with a return type,
 * not a signal to retry the send.
 */
export const ScoutNotificationFollowUpV2ResultSchema = z.strictObject({
  outcome: z.enum(["completed", "skipped", "failed"]),
});
export type ScoutNotificationFollowUpV2Result = z.infer<
  typeof ScoutNotificationFollowUpV2ResultSchema
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
