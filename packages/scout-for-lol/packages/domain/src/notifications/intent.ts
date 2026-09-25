import { z } from "zod";
import { OpaqueVersionedEnvelopeSchema } from "#src/codec/versioned.ts";
import {
  DiscordMessageIdSchema,
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RecoveryBatchIdSchema,
} from "#src/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
} from "#src/identity/discord.ts";

/**
 * Unified notification intent contract.
 *
 * An intent is the durable decision to notify one target once. The state
 * machine is pure: every timestamp, nonce, and identifier is a parameter, so
 * the same inputs always produce the same outputs. The delivery invariants:
 *
 * - `delivered`, `suppressed`, `expired`, and `permission-denied` are terminal.
 *   An intent whose audience was deleted is retired into `suppressed` with a
 *   {@link NotificationRetirementReason}; it is never re-targeted.
 * - `unknown-delivery` is left ONLY via `operatorResolveUnknown` — a send whose
 *   outcome is unobserved must never be retried automatically, because the
 *   retry may double-deliver.
 */

/**
 * What the notification announces, which decides how it is rendered and
 * delivered. A `prematch` intent announces a game that has started and is
 * rendered from the archived spectator snapshot; a `postmatch` intent reports
 * a finished game from its MatchV5 payload; a `settlement` intent tells one
 * guild channel how its Bryan Bucks pool and parlay settled; a `dare-summary`
 * intent tells a channel how one Dare resolved. The kind is a property of the
 * decision to notify, fixed at mint, so a consumer never has to infer it from
 * the key or from whatever payload happens to be available when it runs.
 *
 * The two announcement kinds carry their presentation inputs on the intent
 * (see `announcement` below); the two report kinds carry nothing, because
 * everything they deliver is derived from the match's own durable artifacts.
 */
export type NotificationIntentKind = z.infer<
  typeof NotificationIntentKindSchema
>;
export const NotificationIntentKindSchema = z.enum([
  "postmatch",
  "prematch",
  "settlement",
  "dare-summary",
]);

/** The kinds whose message is built from an `announcement` payload. */
export const ANNOUNCEMENT_INTENT_KINDS: ReadonlySet<NotificationIntentKind> =
  new Set<NotificationIntentKind>(["settlement", "dare-summary"]);

/**
 * Where the decision to notify came from.
 *
 * A `live` intent was minted by the pipeline processing the game as it
 * happened. A `recovery` intent was minted by a recovery batch replaying an
 * outage, and names that batch: the batch's `RecoveryPolicy` governs whether
 * and where the intent may be delivered, and an operator widens that policy
 * on the BATCH (`operatorReleasePolicy`), so carrying the reference rather
 * than a copy of the policy is what lets a release reach every intent born of
 * the batch without rewriting them.
 */
export type NotificationIntentOrigin = z.infer<
  typeof NotificationIntentOriginSchema
>;
export const NotificationIntentOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("live") }),
  z.strictObject({
    kind: z.literal("recovery"),
    recoveryBatchId: RecoveryBatchIdSchema,
  }),
]);

/** The target discriminant on its own, for contracts that carry only it. */
export type NotificationTargetKind = z.infer<
  typeof NotificationTargetKindSchema
>;
export const NotificationTargetKindSchema = z.enum(["channel", "dm"]);

export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
export const NotificationTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal(NotificationTargetKindSchema.enum.channel),
    channelId: DiscordChannelIdSchema,
  }),
  z.strictObject({
    kind: z.literal(NotificationTargetKindSchema.enum.dm),
    accountId: DiscordAccountIdSchema,
  }),
]);

/**
 * Identifies one send attempt. Minted by the caller (never by a transition)
 * so that a crashed worker's attempt and its replacement are distinguishable.
 */
export type NotificationAttemptNonce = z.infer<
  typeof NotificationAttemptNonceSchema
>;
export const NotificationAttemptNonceSchema = z
  .string()
  .min(1)
  .brand<"NotificationAttemptNonce">();

/**
 * Why an intent's audience no longer exists, which retires it.
 *
 * An intent is a decision to tell one audience one thing, and the audience is
 * part of the decision: a channel reached through a subscription, in a guild
 * Scout is installed in. When that audience is deleted before delivery, the
 * intent can never be sent correctly — delivering it to whatever the channel
 * id resolves to now, or re-deriving a target from the subscription that
 * replaced it, would be reconstructing an identity the decision never named.
 * So the intent is retired (`retireOrphaned`), and the reason says which part
 * of the audience went:
 *
 * - `subscription-deleted`: no subscription in the target channel still
 *   follows anyone in the match — unsubscribed, the tracked account removed,
 *   or the guild's data cleaned up.
 * - `channel-deleted`: Discord answered Unknown Channel for the target.
 * - `guild-left`: Discord answered that Scout is no longer in the target
 *   channel's guild.
 */
export type NotificationRetirementReason = z.infer<
  typeof NotificationRetirementReasonSchema
>;
export const NotificationRetirementReasonSchema = z.enum([
  "subscription-deleted",
  "channel-deleted",
  "guild-left",
]);

export type NotificationSuppressionReason = z.infer<
  typeof NotificationSuppressionReasonSchema
>;
export const NotificationSuppressionReasonSchema = z.enum([
  "stale",
  "feature-disabled",
  "recipient-preference",
  ...NotificationRetirementReasonSchema.options,
]);

export type NotificationRetryableFailureReason = z.infer<
  typeof NotificationRetryableFailureReasonSchema
>;
export const NotificationRetryableFailureReasonSchema = z.enum([
  "network",
  "rate-limited",
  "service-unavailable",
  "timeout",
]);

export type NotificationTerminalFailureReason = z.infer<
  typeof NotificationTerminalFailureReasonSchema
>;
export const NotificationTerminalFailureReasonSchema = z.enum([
  "permission-denied",
  "dm-disabled",
  "budget-exhausted",
  "target-not-found",
  /**
   * The content this intent would deliver cannot be produced from what was
   * attested: the artifact its receipt names is missing or is not the bytes
   * the receipt names, or the receipt attests something this kind of
   * notification cannot deliver at all. A fact about the persisted evidence
   * rather than about the target, and no retry reads it differently.
   */
  "content-unavailable",
]);

export type NotificationFailure = z.infer<typeof NotificationFailureSchema>;
export const NotificationFailureSchema = z.discriminatedUnion(
  "classification",
  [
    z.strictObject({
      classification: z.literal("retryable"),
      reason: NotificationRetryableFailureReasonSchema,
    }),
    z.strictObject({
      classification: z.literal("terminal"),
      reason: NotificationTerminalFailureReasonSchema,
    }),
  ],
);

export type NotificationIntentState = z.infer<
  typeof NotificationIntentStateSchema
>;
export const NotificationIntentStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pending") }),
  z.strictObject({ kind: z.literal("ready") }),
  z.strictObject({
    kind: z.literal("sending"),
    attemptNonce: NotificationAttemptNonceSchema,
    startedAt: IsoInstantSchema,
  }),
  z.strictObject({
    kind: z.literal("delivered"),
    messageId: DiscordMessageIdSchema.optional(),
    deliveredAt: IsoInstantSchema,
  }),
  z.strictObject({
    kind: z.literal("suppressed"),
    reason: NotificationSuppressionReasonSchema,
  }),
  z.strictObject({ kind: z.literal("expired") }),
  z.strictObject({ kind: z.literal("permission-denied") }),
  z.strictObject({
    kind: z.literal("unknown-delivery"),
    attemptNonce: NotificationAttemptNonceSchema,
    observedAt: IsoInstantSchema,
  }),
]);

/**
 * How an operator resolves an `unknown-delivery` attempt after investigating:
 * either the message is found (delivered) or its absence is confirmed, which
 * releases the intent back to `ready` for a fresh attempt. The resolution
 * names the attempt it investigated by nonce, so a stale operator view can
 * never resolve a newer attempt it did not look at.
 */
export type OperatorUnknownResolution = z.infer<
  typeof OperatorUnknownResolutionSchema
>;
export const OperatorUnknownResolutionSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("delivered"),
    attemptNonce: NotificationAttemptNonceSchema,
    messageId: DiscordMessageIdSchema.optional(),
    deliveredAt: IsoInstantSchema,
  }),
  z.strictObject({
    outcome: z.literal("confirmed-unsent"),
    attemptNonce: NotificationAttemptNonceSchema,
  }),
]);

export type NotificationIntent = z.infer<typeof NotificationIntentSchema>;
export const NotificationIntentSchema = z
  .strictObject({
    key: NotificationIntentKeySchema,
    kind: NotificationIntentKindSchema,
    origin: NotificationIntentOriginSchema,
    target: NotificationTargetSchema,
    /** Sending after this instant is a conflict; the intent must be suppressed. */
    freshnessDeadline: IsoInstantSchema,
    createdAt: IsoInstantSchema,
    /** Send attempts started so far; incremented by `beginSend`. */
    attemptCount: z.int().nonnegative(),
    /** Most recent recorded failure, kept for diagnosis across retries. */
    lastFailure: NotificationFailureSchema.optional(),
    /**
     * What an announcement kind says, as a versioned envelope the delivery
     * side re-parses with the codec that owns it. Opaque here on purpose:
     * the presentation inputs are the betting slice's own types, and the
     * domain must not mirror them. Present exactly for the kinds in
     * `ANNOUNCEMENT_INTENT_KINDS`; the refinement below is what makes a
     * settlement intent with nothing to say, or a report intent smuggling a
     * payload, unrepresentable.
     */
    announcement: OpaqueVersionedEnvelopeSchema.optional(),
    state: NotificationIntentStateSchema,
  })
  .refine(
    (intent) =>
      (intent.state.kind !== "sending" &&
        intent.state.kind !== "unknown-delivery") ||
      intent.attemptCount >= 1,
    {
      message:
        "sending and unknown-delivery are only reachable after beginSend, so attemptCount must be at least 1",
    },
  )
  .refine(
    (intent) =>
      ANNOUNCEMENT_INTENT_KINDS.has(intent.kind) ===
      (intent.announcement !== undefined),
    {
      message:
        "an announcement payload is carried by exactly the settlement and dare-summary kinds",
    },
  );
