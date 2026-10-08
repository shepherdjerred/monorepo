import { z } from "zod";
import {
  NotificationIntentKeySchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import { ReceiptKindSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import { MatchProcessingConflictReasonSchema } from "@scout-for-lol/domain/match-processing/transitions.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import { NotificationConflictReasonSchema } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { RecoveryConflictReasonSchema } from "@scout-for-lol/domain/recovery/batch-transitions.ts";
import { ScoutStageSchema } from "./contracts.ts";

// ───────────────────────────────────────────────────────────────────────────
// V2 durable pipeline
// ───────────────────────────────────────────────────────────────────────────

/**
 * The shared vocabulary of the V2 durable pipeline: identifier narrowings,
 * references, and the outcome shapes every V2 contract is built from. The
 * Workflow contracts live in `workflow-contracts.ts` and the Activity
 * contracts in `activity-contracts.ts`.
 *
 * The nine V2 Workflow Types are NEW types alongside the v1 ones in
 * `contracts.ts`. No v1 contract changes: open v1 executions recorded the v1
 * shapes and replay them forever.
 *
 * ## Payload rule
 *
 * A V2 Workflow input and result travel in a versioned envelope
 * (`{ kind, version, data }`) built by the domain's `defineVersionedCodec`.
 * Activity inputs and results are flat strict objects.
 *
 * The split follows who READS a payload. The Scout Workflow Worker runs with
 * `useWorkerVersioning` and `VersioningBehavior.AUTO_UPGRADE`, so an open
 * execution moves to the next build: a Workflow input written by build N is
 * read by build N+1 whenever the run outlives a deploy, and a V2 run routinely
 * does. `scoutRecoveryBatchWorkflow` and
 * `scoutPipelineReconciliationWorkflow` rewrite their own input through
 * Continue-As-New; match, notification and lake children follow v1's
 * `parentClosePolicy: "ABANDON"` and so outlive the parent that wrote their
 * input; and a parent replays a completed child's result long after both were
 * written. The envelope gives those payloads an explicit migration hook. The
 * alternative — widening a flat schema with optional fields and defaults — is
 * the fallback this repository forbids, and v1's `PostMatchDiscoveryResult` in
 * `contracts.ts` shows the cost of reaching for it.
 *
 * Activity payloads get the other half of the contract instead: their schemas
 * are strict and CLOSED, and the V2 Activity result shapes are append-only. A
 * lane that needs a breaking change to an Activity result adds a new Activity
 * name rather than redefining one that in-flight histories already recorded.
 *
 * ## What may cross
 *
 * Identifiers, small references, counts, and domain state unions. Never a
 * Riot payload, a rendered report, an image, or a settlement body. Artifact
 * DESCRIPTORS (object key, digest, size) do cross: they name bytes rather
 * than carrying them, and the archival path produces them.
 */

/** Every V2 contract starts at envelope version 1. */
export const SCOUT_CONTRACT_VERSION = 1;

/**
 * The largest identifier list one V2 Activity may return. Discovery, fan-out
 * and reconciliation scans are paged, and this is what makes a page bounded:
 * an activity completion adds at most this many identifiers to a history.
 */
export const SCOUT_PAGE_MAX = 200;

/**
 * Values safe to interpolate into a Scout Workflow ID.
 *
 * `scripts/replay-*-histories.ts` select candidate histories with
 * `^scout-(?:beta|prod)-[\w.:-]+$`. An identifier outside that character set
 * still starts a Workflow, but produces an execution the replay gate cannot
 * see — so the constraint is enforced here, on the identifiers the V2 ID
 * builders interpolate, rather than inside the builders. A builder that threw
 * would throw during a Workflow task and wedge the execution on every retry.
 */
const WORKFLOW_ID_SEGMENT = /^[\w.:-]+$/u;
const workflowIdSegmentIssue = {
  message:
    "must match the replay tooling's workflow-id character set ([A-Za-z0-9_.:-])",
};

/**
 * A notification intent key, narrowed to what a Workflow ID can carry.
 * Intent keys are minted by Scout, so a key outside this set is a broken
 * internal contract rather than bad user input.
 */
export const ScoutNotificationIntentKeySchema =
  NotificationIntentKeySchema.refine(
    (key) => WORKFLOW_ID_SEGMENT.test(key),
    workflowIdSegmentIssue,
  );

/** A recovery batch id, narrowed the same way and for the same reason. */
export const ScoutRecoveryBatchIdSchema = RecoveryBatchIdSchema.refine(
  (id) => WORKFLOW_ID_SEGMENT.test(id),
  workflowIdSegmentIssue,
);

/**
 * Why a V2 Workflow run was started. `gateway-ready` is the Discord gateway
 * reconnect edge; `operator` is a deliberate manual run. The trigger is part
 * of the Workflow ID so two triggers cannot collapse into one execution.
 */
export const ScoutTriggerSchema = z.enum([
  "schedule",
  "gateway-ready",
  "operator",
]);
export type ScoutTrigger = z.infer<typeof ScoutTriggerSchema>;

/**
 * A live game, before Riot's MatchV5 knows about it.
 *
 * Deliberately a reference and not a spectator payload: `platform` and
 * `gameId` are exactly what Riot composes the eventual `RiotMatchId` from, and
 * `puuid` records which tracked account surfaced the game so the fetch can be
 * re-issued. `gameId` is a digit string rather than a number because it only
 * ever gets concatenated into a match id, and a string cannot acquire a
 * floating-point spelling on the way through a payload converter.
 */
export const ScoutPrematchGameRefSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  platform: PlatformRouteSchema,
  gameId: z.string().min(1).max(32).regex(/^\d+$/u),
});
export type ScoutPrematchGameRef = z.infer<typeof ScoutPrematchGameRefSchema>;

/**
 * Every reason a V2 durable commit can refuse, spanning the three pure domain
 * machines and the persistence guards layered under them. Assembled from the
 * domain option tuples so a new domain reason widens this set automatically;
 * the trailing literals are repository-only, raised by comparing a stored
 * payload blob that no pure transition ever sees.
 */
export const ScoutDurableCommitConflictReasonSchema = z.enum([
  ...MatchProcessingConflictReasonSchema.options,
  ...NotificationConflictReasonSchema.options,
  ...RecoveryConflictReasonSchema.options,
  "observation-differs",
  "intent-differs",
  "batch-differs",
  /**
   * A standing settlement-announcement instruction differs from the one this
   * settlement produced for the same item — two producers disagreeing about
   * what ONE settlement did. Raised by
   * `settlement-announcement-repository.ts` comparing stored payload bytes,
   * which no pure transition ever sees.
   */
  "settlement-announcement-differs",
  "workflow-adopted-by-another-batch",
  /**
   * The recovery policy governing a recovery-born intent does not permit its
   * target, so the send was refused before an attempt was committed. Raised
   * by the notification lane's Activities against the batch row rather than
   * by a pure transition, because the policy lives on the batch and the
   * frozen intent machine stays ignorant of who minted an intent.
   */
  "policy-held",
]);
export type ScoutDurableCommitConflictReason = z.infer<
  typeof ScoutDurableCommitConflictReasonSchema
>;

/**
 * What a durable write answered.
 *
 * This is the REPOSITORY's vocabulary (`DurableWriteOutcomeSchema`), not the
 * pure domain transition's, and the difference is load-bearing in two places.
 * `adopted` exists only in the repositories. And drift detection now lives
 * there too: the domain's `recordReceipt` compares receipt identity alone, so
 * only `receipt-repository.ts` can answer `receipt-evidence-mismatch` by
 * comparing the stored evidence blob. An Activity result that reported the
 * domain answer would be structurally unable to report the drift.
 *
 * A V2 Activity that performs an at-most-once effect reports the GUARD and
 * the FACT as separate fields, never as one outcome. `ScoutEffectClaim` takes
 * the top-level Prisma client rather than a transaction-scoped handle, so a
 * claim and the durable fact it guards cannot commit atomically; every
 * contract here therefore tolerates two commits and names the reconcile.
 */
export const ScoutDurableCommitSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("applied") }),
  z.strictObject({ outcome: z.literal("already-applied") }),
  z.strictObject({ outcome: z.literal("adopted") }),
  z.strictObject({
    outcome: z.literal("conflict"),
    reason: ScoutDurableCommitConflictReasonSchema,
  }),
]);
export type ScoutDurableCommit = z.infer<typeof ScoutDurableCommitSchema>;

/** One receipt write, named by kind and answered in repository vocabulary. */
export const ScoutReceiptOutcomeSchema = z.strictObject({
  kind: ReceiptKindSchema,
  commit: ScoutDurableCommitSchema,
});
export type ScoutReceiptOutcome = z.infer<typeof ScoutReceiptOutcomeSchema>;

// ─── V2 references ─────────────────────────────────────────────────────────

/** One match, in one stage. The unit of work the V2 pipeline is keyed by. */
export const ScoutMatchRefSchema = z.strictObject({
  stage: ScoutStageSchema,
  riotMatchId: RiotMatchIdSchema,
});
export type ScoutMatchRef = z.infer<typeof ScoutMatchRefSchema>;

/** One live game, in one stage. */
export const ScoutGameRefSchema = z.strictObject({
  stage: ScoutStageSchema,
  gameRef: ScoutPrematchGameRefSchema,
});
export type ScoutGameRef = z.infer<typeof ScoutGameRefSchema>;

/** One notification intent, in one stage. */
export const ScoutIntentRefSchema = z.strictObject({
  stage: ScoutStageSchema,
  intentKey: ScoutNotificationIntentKeySchema,
});
export type ScoutIntentRef = z.infer<typeof ScoutIntentRefSchema>;

/**
 * One send attempt of one intent. The nonce is minted by the Workflow, never
 * by a transition, so a crashed worker's attempt and its replacement stay
 * distinguishable — which is what lets an unobserved send be recorded as
 * `unknown-delivery` against the exact attempt that produced it.
 */
export const ScoutIntentAttemptRefSchema = ScoutIntentRefSchema.extend({
  attemptNonce: NotificationAttemptNonceSchema,
});
export type ScoutIntentAttemptRef = z.infer<typeof ScoutIntentAttemptRefSchema>;

/** One recovery batch, in one stage. */
export const ScoutRecoveryBatchRefSchema = z.strictObject({
  stage: ScoutStageSchema,
  recoveryBatchId: ScoutRecoveryBatchIdSchema,
});
export type ScoutRecoveryBatchRef = z.infer<typeof ScoutRecoveryBatchRefSchema>;
