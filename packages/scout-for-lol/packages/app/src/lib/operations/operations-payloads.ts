import {
  OperationsIntentPayloadSchema,
  type OperationsIntentKind,
  type OperationsIntentPayload,
} from "@scout-for-lol/data";
import type { ConfirmationCardState } from "#src/lib/explore/explore-intent-cards.ts";

/**
 * Turning what an operator filled in into a payload the server will accept.
 *
 * The draft is loose strings because that is what a form holds; the payload is
 * the shared `OperationsIntentPayloadSchema`. Parsing through that exact schema
 * rather than a console-local copy is the point: an id, a nonce or an instant
 * the server would reject is rejected here too, in the same vocabulary, and the
 * branded values the API needs come out of the parse rather than an assertion.
 *
 * Deliberately React-free. Every summary below is the sentence an operator
 * reads before authorizing a pipeline action, so what it promises has to be
 * pinned by tests rather than reviewed by eye — and none of them may promise
 * more than the arm actually does.
 */

export type OperationsDeliveryOutcome = "delivered" | "not-delivered";

export type OperationsRequestDraft =
  | { readonly kind: "ops_reconcile_pipeline" }
  | { readonly kind: "ops_retry_notification"; readonly intentKey: string }
  | {
      readonly kind: "ops_suppress_stale_notification";
      readonly intentKey: string;
      readonly note: string;
    }
  | {
      readonly kind: "ops_resolve_unknown_delivery";
      readonly intentKey: string;
      readonly attemptNonce: string;
      readonly outcome: OperationsDeliveryOutcome;
      readonly messageId: string;
      readonly deliveredAt: string;
    }
  | { readonly kind: "ops_repair_projection"; readonly riotMatchId: string }
  | {
      readonly kind: "ops_release_recovery_policy";
      readonly recoveryBatchId: string;
    };

/**
 * The two things that can be asked of a notification intent that is merely
 * stuck, as a pair rather than a list.
 *
 * Returned keyed instead of ordered because they are never both offerable:
 * a re-drive only applies before the freshness deadline and a stale
 * suppression only after it, so a caller picks one. `notificationActions`
 * makes that choice; this only builds the drafts.
 */
export function notificationDrafts(intentKey: string): {
  readonly retry: OperationsRequestDraft;
  readonly suppress: OperationsRequestDraft;
} {
  return {
    retry: { kind: "ops_retry_notification", intentKey },
    suppress: { kind: "ops_suppress_stale_notification", intentKey, note: "" },
  };
}

/**
 * A blank answer to one unknown delivery, bound to the attempt it names.
 *
 * `not-delivered` is the starting position because it is the answer that can
 * be taken back: it releases the intent for a fresh attempt, whereas
 * `delivered` is permanent and unfalsifiable. The operator opts in to the
 * irreversible one.
 */
export function resolveDeliveryDraft(args: {
  intentKey: string;
  attemptNonce: string;
}): OperationsRequestDraft {
  return {
    kind: "ops_resolve_unknown_delivery",
    intentKey: args.intentKey,
    attemptNonce: args.attemptNonce,
    outcome: "not-delivered",
    messageId: "",
    deliveredAt: "",
  };
}

const ARM_LABEL: Record<OperationsIntentKind, string> = {
  ops_reconcile_pipeline: "Reconcile the pipeline",
  ops_retry_notification: "Re-drive this notification",
  ops_suppress_stale_notification: "Suppress this stale notification",
  ops_resolve_unknown_delivery: "Answer this unknown delivery",
  ops_repair_projection: "Repair this projection",
  ops_release_recovery_policy: "Widen this batch's policy",
};

const ARM_FAILED_HEADING: Record<OperationsIntentKind, string> = {
  ops_reconcile_pipeline: "The pipeline was not reconciled",
  ops_retry_notification: "The notification was not re-driven",
  ops_suppress_stale_notification: "The notification was not suppressed",
  ops_resolve_unknown_delivery: "The delivery was not resolved",
  ops_repair_projection: "The projection was not repaired",
  ops_release_recovery_policy: "The policy was not widened",
};

/** Short verb for a control in a dense table. */
const ARM_ACTION: Record<OperationsIntentKind, string> = {
  ops_reconcile_pipeline: "Reconcile",
  ops_retry_notification: "Re-drive",
  ops_suppress_stale_notification: "Suppress",
  ops_resolve_unknown_delivery: "Answer",
  ops_repair_projection: "Repair",
  ops_release_recovery_policy: "Widen policy",
};

export function operationsArmLabel(kind: OperationsIntentKind): string {
  return ARM_LABEL[kind];
}

export function operationsActionLabel(kind: OperationsIntentKind): string {
  return ARM_ACTION[kind];
}

/**
 * Whether confirming this arm ends in a Workflow start.
 *
 * Three arms describe a start and three move durable state inside the claiming
 * transaction. The distinction matters to the console because a start with no
 * Temporal connection produces a durable request nothing will pick up — so
 * those three are not offered while Temporal is unreachable, and the other
 * three still are.
 */
export function operationsStartsWorkflow(kind: OperationsIntentKind): boolean {
  return (
    kind === "ops_reconcile_pipeline" ||
    kind === "ops_retry_notification" ||
    kind === "ops_repair_projection"
  );
}

/**
 * The card's heading while a confirmation is unanswered.
 *
 * A settled card takes its heading from the outcome instead, because only the
 * outcome knows whether anything actually moved.
 */
export function operationsCardHeading(
  kind: OperationsIntentKind,
  state: ConfirmationCardState,
): string {
  switch (state) {
    case "confirmed":
      return ARM_LABEL[kind];
    case "failed":
      return ARM_FAILED_HEADING[kind];
    case "expired":
      return "This confirmation expired";
    case "pending":
    case "confirming":
      return ARM_LABEL[kind];
  }
}

/** What confirming will do, in the arm's own terms. */
export function operationsRequestSummary(
  draft: OperationsRequestDraft,
): string {
  switch (draft.kind) {
    case "ops_reconcile_pipeline":
      return "Confirming authorizes a reconciliation sweep over the durable pipeline and asks Temporal to start it. Nothing is running yet.";
    case "ops_retry_notification":
      return `Confirming authorizes a notification Workflow for ${draft.intentKey} and asks Temporal to start it. This cannot rescue an intent that is already sending — answer its unknown delivery instead.`;
    case "ops_suppress_stale_notification":
      return `Confirming asks the notification machine to suppress ${draft.intentKey} as stale. The machine stamps the reason itself; your note lands on the audit row. An intent whose freshness deadline has not passed is refused as not-stale.`;
    case "ops_resolve_unknown_delivery":
      return draft.outcome === "delivered"
        ? `Confirming records attempt ${draft.attemptNonce} of ${draft.intentKey} as delivered, naming the message you found. The resulting delivered state is permanent.`
        : `Confirming records attempt ${draft.attemptNonce} of ${draft.intentKey} as confirmed unsent, which releases the intent for a fresh attempt.`;
    case "ops_repair_projection":
      return `Confirming authorizes a lake projection run for ${draft.riotMatchId} and asks Temporal to start it. Whether anything is left to stage is the Workflow's own question.`;
    case "ops_release_recovery_policy":
      return `Confirming widens ${draft.recoveryBatchId}'s blast radius to stale-private-only, which is the only widening the machine permits.`;
  }
}

/** The shape the draft is asking the server to store, before validation. */
function payloadCandidate(draft: OperationsRequestDraft): unknown {
  switch (draft.kind) {
    case "ops_reconcile_pipeline":
      return { kind: draft.kind, version: 1 };
    case "ops_retry_notification":
      return { kind: draft.kind, version: 1, intentKey: draft.intentKey };
    case "ops_suppress_stale_notification":
      return {
        kind: draft.kind,
        version: 1,
        intentKey: draft.intentKey,
        note: draft.note,
      };
    case "ops_resolve_unknown_delivery":
      return {
        kind: draft.kind,
        version: 1,
        intentKey: draft.intentKey,
        answer:
          draft.outcome === "delivered"
            ? {
                outcome: "delivered",
                attemptNonce: draft.attemptNonce,
                messageId: draft.messageId,
                deliveredAt: draft.deliveredAt,
              }
            : { outcome: "not-delivered", attemptNonce: draft.attemptNonce },
      };
    case "ops_repair_projection":
      return { kind: draft.kind, version: 1, riotMatchId: draft.riotMatchId };
    case "ops_release_recovery_policy":
      return {
        kind: draft.kind,
        version: 1,
        recoveryBatchId: draft.recoveryBatchId,
        to: "stale-private-only",
      };
  }
}

/**
 * A validated Riot match id, in the branded form the operations reads expect.
 *
 * Taken off the payload union rather than imported, because the SPA depends on
 * `@scout-for-lol/data` and not on `@scout-for-lol/domain`, where the brand is
 * declared. The repair arm already carries one.
 */
export type OperationsMatchId = Extract<
  OperationsIntentPayload,
  { kind: "ops_repair_projection" }
>["riotMatchId"];

/**
 * Validate a match id an operator typed or a row handed over.
 *
 * Parsed through the same shared schema the server parses, so the console
 * cannot accept an id the pipeline would reject — and the branded value comes
 * out of the parse rather than an assertion.
 */
export function parseOperationsMatchId(
  value: string,
): OperationsMatchId | null {
  const parsed = OperationsIntentPayloadSchema.safeParse({
    kind: "ops_repair_projection",
    version: 1,
    riotMatchId: value.trim(),
  });
  return parsed.success && parsed.data.kind === "ops_repair_projection"
    ? parsed.data.riotMatchId
    : null;
}

export type OperationsPayloadResult =
  | { readonly status: "valid"; readonly payload: OperationsIntentPayload }
  | { readonly status: "invalid"; readonly message: string };

/**
 * Validate a draft against the server's own payload schema.
 *
 * A failure here is an operator typing mistake — a malformed message id, an
 * instant that is not an instant — so it is answered with the field and the
 * reason rather than thrown.
 */
export function buildOperationsPayload(
  draft: OperationsRequestDraft,
): OperationsPayloadResult {
  const parsed = OperationsIntentPayloadSchema.safeParse(
    payloadCandidate(draft),
  );
  if (parsed.success) {
    return { status: "valid", payload: parsed.data };
  }
  const issue = parsed.error.issues[0];
  if (issue === undefined) {
    return { status: "invalid", message: "That request is not valid." };
  }
  const field = issue.path.at(-1);
  return {
    status: "invalid",
    message:
      field === undefined
        ? issue.message
        : `${String(field)}: ${issue.message}`,
  };
}
