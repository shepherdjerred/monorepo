import { z } from "zod";
import {
  DiscordMessageIdSchema,
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";

/**
 * The confirmation-intent arms that operate the durable match pipeline.
 *
 * These are the operator half of the same protocol Explore and Dares use: a
 * prepared, actor-bound, single-use, expiring row that a human confirms before
 * anything happens. Nothing here is authorization — the operations procedures
 * re-check the operator allowlist server-side at confirm time, and the guild
 * is read off the intent row rather than out of a payload.
 *
 * What is deliberately ABSENT is as load-bearing as what is present:
 *
 * - No stage. Which Temporal stage a run targets is resolved from the server's
 *   own environment at confirm time, never chosen by the requester, so an
 *   operator on beta cannot mint an intent that drives production.
 * - No free choice of domain outcome. Each arm names exactly the one
 *   transition the frozen domain machine will actually perform, so a stored
 *   intent cannot describe an effect the machine would refuse.
 */

/**
 * An operator's written justification. Audit metadata only — it is recorded on
 * the audit row and never reaches a domain state, because the notification
 * machine's suppression reason is a closed enum the operator does not pick.
 */
export const OperatorNoteSchema = z.string().trim().min(1).max(280);
export type OperatorNote = z.infer<typeof OperatorNoteSchema>;

/**
 * How an operator answers an `unknown-delivery` attempt.
 *
 * `attemptNonce` is required on both answers and is the whole point of the
 * shape: it names the attempt the operator actually investigated, so a stale
 * console view cannot resolve a newer attempt nobody looked at. The domain
 * refuses a mismatch as `stale-operator-view`.
 *
 * `delivered` requires a `messageId`. The domain allows it to be absent, but
 * an operator claiming a message was delivered without being able to name it
 * has not finished investigating, and the resulting `delivered` state is
 * permanent and unfalsifiable.
 */
export const OperatorDeliveryAnswerSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("delivered"),
    attemptNonce: NotificationAttemptNonceSchema,
    messageId: DiscordMessageIdSchema,
    deliveredAt: IsoInstantSchema,
  }),
  z.strictObject({
    outcome: z.literal("not-delivered"),
    attemptNonce: NotificationAttemptNonceSchema,
  }),
]);
export type OperatorDeliveryAnswer = z.infer<
  typeof OperatorDeliveryAnswerSchema
>;

/**
 * The operations arms of {@link ConfirmationIntentPayloadSchema}.
 *
 * Exported as an array rather than a union so the confirmation-intent module
 * can spread them into the one discriminated union every stored payload parses
 * through, exactly as the dare and creation arms are spread.
 */
export const operationsIntentPayloadArms = [
  /** Sweep the durable pipeline for work its owners dropped. */
  z.strictObject({
    kind: z.literal("ops_reconcile_pipeline"),
    version: z.literal(1),
  }),
  /**
   * Re-drive one notification intent that is waiting to be sent.
   *
   * This cannot rescue a wedged `sending` intent: the machine refuses to leave
   * `sending` without an operator first recording the outcome as unknown and
   * then answering it. Those go through `ops_resolve_unknown_delivery`.
   */
  z.strictObject({
    kind: z.literal("ops_retry_notification"),
    version: z.literal(1),
    intentKey: NotificationIntentKeySchema,
  }),
  /**
   * Suppress a notification intent whose freshness deadline has passed.
   *
   * The domain's only suppression transition stamps the reason `stale` itself;
   * the operator's `note` is why they did it now, and lands on the audit row.
   */
  z.strictObject({
    kind: z.literal("ops_suppress_stale_notification"),
    version: z.literal(1),
    intentKey: NotificationIntentKeySchema,
    note: OperatorNoteSchema,
  }),
  /** Answer an attempt whose delivery outcome was never observed. */
  z.strictObject({
    kind: z.literal("ops_resolve_unknown_delivery"),
    version: z.literal(1),
    intentKey: NotificationIntentKeySchema,
    answer: OperatorDeliveryAnswerSchema,
  }),
  /** Re-run lake projection for one match whose staging never landed. */
  z.strictObject({
    kind: z.literal("ops_repair_projection"),
    version: z.literal(1),
    riotMatchId: RiotMatchIdSchema,
  }),
  /**
   * Widen a recovery batch's blast-radius policy.
   *
   * `to` is a literal rather than the open `RecoveryPolicy` enum because
   * `stale-private-only` is the only widening the domain permits — every other
   * target, `normal` included, is refused. Spelling it as a literal makes an
   * unauthorizable request unrepresentable instead of merely rejected.
   */
  z.strictObject({
    kind: z.literal("ops_release_recovery_policy"),
    version: z.literal(1),
    recoveryBatchId: RecoveryBatchIdSchema,
    to: z.literal("stale-private-only"),
  }),
] as const;

/** The kinds that operate the durable match pipeline. */
export const OperationsIntentKindSchema = z.enum([
  "ops_reconcile_pipeline",
  "ops_retry_notification",
  "ops_suppress_stale_notification",
  "ops_resolve_unknown_delivery",
  "ops_repair_projection",
  "ops_release_recovery_policy",
]);
export type OperationsIntentKind = z.infer<typeof OperationsIntentKindSchema>;

export const OperationsIntentPayloadSchema = z.discriminatedUnion(
  "kind",
  operationsIntentPayloadArms,
);
export type OperationsIntentPayload = z.infer<
  typeof OperationsIntentPayloadSchema
>;
