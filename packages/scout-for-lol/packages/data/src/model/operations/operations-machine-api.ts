import { z } from "zod";
import {
  OperationsIntentKindSchema,
  OperationsIntentPayloadSchema,
  OperatorNoteSchema,
} from "#src/model/operations/operations-intent.ts";

/**
 * The machine (non-browser) surface of the operations console.
 *
 * It is the same prepare-and-confirm protocol the console runs, collapsed into
 * one request for a caller that has already done its review: the backend mints
 * an intent bound to the credential's operator and claims it in the same call,
 * so the single-use claim, the audit row and the post-commit Workflow dispatch
 * are exactly the browser path's. What a machine caller adds is a required
 * `note` (its justification, recorded on the audit row) and an
 * `idempotencyKey` it chooses, so a retry after a lost response returns the
 * stored result instead of acting twice.
 *
 * Shared by the backend, which parses requests and its own responses through
 * these schemas, and by `toolkit scout ops`, which parses the responses.
 */

export const OPERATIONS_MACHINE_API_PREFIX = "/api/operations/v1";

/**
 * A machine operations token. The prefix makes a leaked value recognisable and
 * lets the backend refuse anything else before hashing it.
 */
export const OPERATIONS_MACHINE_TOKEN_PREFIX = "sop_";
export const OperationsMachineTokenSchema = z
  .string()
  .regex(/^sop_[\w-]{32,128}$/);

/**
 * A caller-chosen retry key. Reusing one with a different payload is refused
 * as a conflict rather than answered with someone else's result.
 */
export const OperationsIdempotencyKeySchema = z
  .string()
  .regex(/^[\da-z][\w.:-]{7,127}$/i);

export const OperationsMachineSubmitRequestSchema = z.strictObject({
  payload: OperationsIntentPayloadSchema,
  idempotencyKey: OperationsIdempotencyKeySchema,
  note: OperatorNoteSchema,
});
export type OperationsMachineSubmitRequest = z.infer<
  typeof OperationsMachineSubmitRequestSchema
>;

/**
 * What the durable machine did. The backend owns the closed vocabulary; the
 * contract pins only the discriminator a caller branches on.
 */
const OperationsOutcomeSchema = z.looseObject({ kind: z.string().min(1) });
const OperationsDispatchSchema = z.looseObject({
  outcome: z.string().min(1),
});

export const OperationsMachineSubmitResponseSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("executed"),
      intentId: z.uuid(),
      outcome: OperationsOutcomeSchema,
      dispatch: OperationsDispatchSchema.nullable(),
    }),
    /**
     * This key was already used for this payload. `result` is the outcome the
     * first request stored; nothing ran again and nothing was dispatched.
     */
    z.strictObject({
      kind: z.literal("already_consumed"),
      intentId: z.uuid(),
      result: z.json(),
    }),
    /**
     * An earlier request with this key minted an intent but never claimed it
     * (its transaction rolled back), and the intent has since expired. Nothing
     * ran; retry with a new key.
     */
    z.strictObject({
      kind: z.literal("intent_expired"),
      intentId: z.uuid(),
    }),
  ],
);
export type OperationsMachineSubmitResponse = z.infer<
  typeof OperationsMachineSubmitResponseSchema
>;

export const OperationsIntentStatusSchema = z.strictObject({
  intentId: z.uuid(),
  state: z.enum(["pending", "expired", "consumed"]),
  kind: OperationsIntentKindSchema,
  expiresAt: z.iso.datetime(),
  result: z.json().nullable(),
});
export type OperationsIntentStatus = z.infer<
  typeof OperationsIntentStatusSchema
>;

const QueuePageSchema = z.strictObject({
  hasMore: z.boolean(),
  cursor: z.string().nullable(),
});

/** The one subject a notification intent is about (exactly one is present). */
const notificationSubjectFields = {
  matchId: z.string().optional(),
  duelId: z.string().optional(),
  dareId: z.int().optional(),
  announcementId: z.string().optional(),
};
const StalledNotificationSchema = z.strictObject({
  intentKey: z.string(),
  state: z.string(),
  freshnessDeadline: z.string(),
  attemptCount: z.int(),
  ...notificationSubjectFields,
});
/**
 * An attempt whose delivery was never observed. `attemptNonce` is required by
 * `ops_resolve_unknown_delivery`; the domain refuses any other nonce.
 */
const UnknownDeliverySchema = z.strictObject({
  intentKey: z.string(),
  attemptCount: z.int(),
  attemptNonce: z.string(),
  state: z.string(),
  ...notificationSubjectFields,
});

export const OPERATIONS_QUEUE_NAMES = [
  "stalledMatchProcessing",
  "stalledNotifications",
  "unknownDeliveries",
  "unprojectedMatches",
  "liveRecoveryBatches",
  "unacceptedWorkflowStarts",
] as const;
export const OperationsQueueNameSchema = z.enum(OPERATIONS_QUEUE_NAMES);
export type OperationsQueueName = z.infer<typeof OperationsQueueNameSchema>;

export const OperationsQueuesSchema = z.strictObject({
  stalledMatchProcessing: z.array(z.string()),
  stalledNotifications: z.array(StalledNotificationSchema),
  unknownDeliveries: z.array(UnknownDeliverySchema),
  unprojectedMatches: z.array(z.string()),
  liveRecoveryBatches: z.array(z.string()),
  unacceptedWorkflowStarts: z.array(
    z.strictObject({
      requestId: z.string(),
      requestedWorkflowId: z.string(),
      workflowType: z.string(),
      requestedAt: z.string(),
      requestSource: z.string(),
    }),
  ),
  pages: z.strictObject({
    stalledMatchProcessing: QueuePageSchema,
    stalledNotifications: QueuePageSchema,
    unknownDeliveries: QueuePageSchema,
    unprojectedMatches: QueuePageSchema,
    liveRecoveryBatches: QueuePageSchema,
    unacceptedWorkflowStarts: QueuePageSchema,
  }),
});
export type OperationsQueues = z.infer<typeof OperationsQueuesSchema>;

/**
 * A report chunk whose delivery is unresolved. `nonce` is the attempt an
 * `ops_resolve_report_delivery` answer must name. Message content is left out:
 * an operator needs the coordinates, not the report.
 */
export const OperationsReportDeliverySchema = z.strictObject({
  runId: z.int(),
  channelId: z.string(),
  chunkIndex: z.int().nonnegative(),
  serverId: z.string(),
  state: z.enum(["UNKNOWN", "SENDING"]),
  nonce: z.string(),
  messageId: z.string().nullable(),
  sendStartedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const OperationsReportDeliveriesSchema = z.strictObject({
  chunks: z.array(OperationsReportDeliverySchema),
});
export type OperationsReportDeliveries = z.infer<
  typeof OperationsReportDeliveriesSchema
>;

export const OperationsMachineErrorSchema = z.strictObject({
  error: z.enum([
    "unauthorized",
    "forbidden",
    "not_found",
    "method_not_allowed",
    "invalid_request",
    "unsupported_media_type",
    "payload_too_large",
    "idempotency_conflict",
  ]),
  message: z.string(),
  issues: z
    .array(z.strictObject({ path: z.string(), message: z.string() }))
    .optional(),
});
export type OperationsMachineError = z.infer<
  typeof OperationsMachineErrorSchema
>;
