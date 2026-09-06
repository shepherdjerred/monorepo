import { z } from "zod";
import {
  DiscordMessageIdSchema,
  IsoInstantSchema,
  NotificationIntentKeySchema,
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
 * - `unknown-delivery` is left ONLY via `operatorResolveUnknown` — a send whose
 *   outcome is unobserved must never be retried automatically, because the
 *   retry may double-deliver.
 */

export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
export const NotificationTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("channel"),
    channelId: DiscordChannelIdSchema,
  }),
  z.strictObject({
    kind: z.literal("dm"),
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

export type NotificationSuppressionReason = z.infer<
  typeof NotificationSuppressionReasonSchema
>;
export const NotificationSuppressionReasonSchema = z.enum([
  "stale",
  "feature-disabled",
  "recipient-preference",
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
    target: NotificationTargetSchema,
    /** Sending after this instant is a conflict; the intent must be suppressed. */
    freshnessDeadline: IsoInstantSchema,
    createdAt: IsoInstantSchema,
    /** Send attempts started so far; incremented by `beginSend`. */
    attemptCount: z.int().nonnegative(),
    /** Most recent recorded failure, kept for diagnosis across retries. */
    lastFailure: NotificationFailureSchema.optional(),
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
  );
