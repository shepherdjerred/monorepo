import { z } from "zod";

/**
 * Reading the operations API's answer to one confirmation.
 *
 * React-free for the same reason the Explore classifiers are: the interesting
 * half of an operator surface is deciding what a closed union of server answers
 * actually means, and that decision has to be testable without a renderer.
 *
 * The rule this module exists to enforce is that the console never claims an
 * effect that did not happen. Two fields carry it:
 *
 * - `status` is how the shared confirmation card reads — the same
 *   confirmed/failed axis every Explore card uses.
 * - `effect` is whether THIS confirmation changed anything. It is separate
 *   because the two genuinely disagree: a Workflow start that joined a run and
 *   a replayed suppression both leave the world in the shape the operator asked
 *   for, and neither was done by the call being reported.
 *
 * Nothing here produces a `retryable` flag, and that is deliberate rather than
 * an omission. Every answer below is terminal for the intent that produced it:
 * a claimed intent is spent, and an expired one cannot be claimed. Wanting the
 * operation again means preparing a new intent, which is a new authorization
 * rather than a retry of a spent one — so no outcome may offer a retry control.
 *
 * The input is `unknown` rather than the tRPC output type because the same
 * value arrives from two places: `confirm` returns it typed, and
 * `intentStatus` replays the stored outcome as opaque JSON.
 */

export type OperationsOutcomeFact = {
  readonly label: string;
  readonly value: string;
};

export type OperationsConfirmationOutcome = {
  /** How the shared confirmation card reads this answer. */
  readonly status: "confirmed" | "failed";
  /**
   * Whether this confirmation produced the operation's effect. `none` is not a
   * synonym for failure — a replay and an already-applied transition both leave
   * the durable state as asked without this call having moved it.
   */
  readonly effect: "performed" | "none";
  readonly heading: string;
  readonly message: string;
  readonly facts: readonly OperationsOutcomeFact[];
  /** The server's own refusal word, when it gave one. Never invented here. */
  readonly reason: string | null;
};

const WorkflowKindSchema = z.enum([
  "reconcile-pipeline",
  "repair-projection",
  "retry-notification",
]);

const NotificationStateSchema = z.enum([
  "pending",
  "ready",
  "sending",
  "delivered",
  "suppressed",
  "expired",
  "permission-denied",
  "unknown-delivery",
]);

const ConflictReasonSchema = z.enum([
  "invalid-source-state",
  "terminal-state",
  "unknown-delivery-requires-operator",
  "already-sending",
  "attempt-nonce-mismatch",
  "send-in-flight",
  "freshness-deadline-passed",
  "not-stale",
  "stale-operator-view",
  "scan-budget-exhausted",
  "stale-cursor",
  "counts-regressed",
  "counts-discovered-changed",
  "counts-exceed-discovered",
  "items-unaccounted",
  "policy-immutable",
  "policy-release-forbidden",
]);
type ConflictReason = z.infer<typeof ConflictReasonSchema>;

const OutcomeSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("start-authorized"),
    workflow: WorkflowKindSchema,
  }),
  z.looseObject({
    kind: z.literal("notification-suppressed"),
    intentKey: z.string(),
  }),
  z.looseObject({
    kind: z.literal("delivery-resolved"),
    intentKey: z.string(),
    intentState: NotificationStateSchema,
  }),
  z.looseObject({
    kind: z.literal("recovery-policy-released"),
    recoveryBatchId: z.string(),
  }),
  z.looseObject({ kind: z.literal("already-applied") }),
  z.looseObject({
    kind: z.literal("machine-refused"),
    reason: ConflictReasonSchema,
  }),
  z.looseObject({
    kind: z.literal("not-drivable"),
    intentKey: z.string(),
    intentState: NotificationStateSchema,
  }),
  z.looseObject({
    kind: z.literal("target-not-found"),
    target: z.enum(["notification-intent", "match", "recovery-batch"]),
    id: z.string(),
  }),
]);

const DispatchSchema = z.discriminatedUnion("outcome", [
  z.looseObject({
    outcome: z.literal("reached-running"),
    requestedWorkflowId: z.string(),
    runId: z.string(),
  }),
  z.looseObject({
    outcome: z.literal("joined-running"),
    requestedWorkflowId: z.string(),
    runId: z.string(),
  }),
  z.looseObject({
    outcome: z.literal("unavailable"),
    requestedWorkflowId: z.string(),
  }),
  z.looseObject({
    outcome: z.literal("already-run"),
    requestedWorkflowId: z.string(),
  }),
]);

const ConfirmResultSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("executed"),
    outcome: OutcomeSchema,
    dispatch: DispatchSchema.nullable(),
  }),
  z.looseObject({ kind: z.literal("intent_expired") }),
  z.looseObject({ kind: z.literal("already_consumed"), result: z.unknown() }),
]);

const WORKFLOW_LABEL: Record<z.infer<typeof WorkflowKindSchema>, string> = {
  "reconcile-pipeline": "Pipeline reconciliation",
  "repair-projection": "Lake projection repair",
  "retry-notification": "Notification retry",
};

const TARGET_LABEL = {
  "notification-intent": "notification intent",
  match: "match",
  "recovery-batch": "recovery batch",
} as const;

/**
 * The durable machines' refusals, in prose.
 *
 * One entry per member of the two closed enums, because a refusal an operator
 * cannot read is a refusal they will work around. `not-stale` in particular is
 * a normal answer rather than a fault: it is what suppressing an intent whose
 * freshness deadline has not passed is supposed to produce.
 */
const CONFLICT_COPY: Record<ConflictReason, string> = {
  "invalid-source-state":
    "The record is not in a state this transition can start from.",
  "terminal-state": "The record has already settled and cannot move again.",
  "unknown-delivery-requires-operator":
    "This intent is waiting on an answer to its unknown delivery; resolve that first.",
  "already-sending": "A send is already in flight for this intent.",
  "attempt-nonce-mismatch":
    "The attempt this request names is not the attempt the record is on.",
  "send-in-flight":
    "A send is in flight and has to settle before this applies.",
  "freshness-deadline-passed": "The intent's freshness deadline has passed.",
  "not-stale":
    "This intent is not stale. Its freshness deadline has not passed, so the machine will not suppress it as stale.",
  "stale-operator-view":
    "The console was showing an older attempt than the one the record is on. Reload and answer the current attempt.",
  "scan-budget-exhausted": "The batch has spent its scan budget.",
  "stale-cursor": "The batch has moved past the cursor this request carried.",
  "counts-regressed": "The batch's counts would go backwards.",
  "counts-discovered-changed": "The batch's discovered count has changed.",
  "counts-exceed-discovered":
    "The batch's counts would exceed what it discovered.",
  "items-unaccounted": "The batch still has items it cannot account for.",
  "policy-immutable": "This batch's policy cannot be changed.",
  "policy-release-forbidden":
    "The machine refuses to widen this batch's policy.",
};

/**
 * What recovers a start Temporal never accepted — per family, because the
 * answer differs and only one of them applies to the operator reading it.
 *
 * The reconciliation sweep re-drives the foldable families. It deliberately
 * refuses to fold a reconciliation start, precisely so nothing re-drives that
 * one automatically — which makes "wait for the sweep" the wrong instruction
 * for exactly the arm an operator is most likely to be using during an
 * incident. Telling every reader both rules and leaving them to work out which
 * is theirs is how an unaccepted reconciliation sits forgotten.
 */
const UNAVAILABLE_RECOVERY: Record<
  z.infer<typeof WorkflowKindSchema>,
  string
> = {
  "reconcile-pipeline":
    "Nothing will pick this up on its own: the reconciliation sweep refuses to fold a reconciliation start. Request it again once Temporal is reachable, which adopts this record rather than duplicating it.",
  "repair-projection":
    "The reconciliation sweep re-drives unaccepted lake-projection starts, so this is picked up once Temporal is reachable.",
  "retry-notification":
    "The reconciliation sweep re-drives unaccepted notification starts, so this is picked up once Temporal is reachable.",
};

/**
 * What Temporal's reuse-policy refusal actually proves, per family.
 *
 * `already-run` is one dispatch outcome but not one fact, because the policy
 * behind it differs and a `USE_EXISTING` conflict policy means an OPEN run is
 * joined rather than refused — so this is always a CLOSED execution.
 *
 * - Lake projection runs `ALLOW_DUPLICATE_FAILED_ONLY`, which re-runs after a
 *   failure. A refusal therefore proves the previous run did NOT fail, so
 *   "already ran to completion" is a claim the outcome supports.
 * - Reconciliation and notification both run `ALLOW_DUPLICATE`, which never
 *   refuses a duplicate. Reaching this branch means the policy and this answer
 *   disagree, which is a fact about the system rather than about the
 *   operator's request. (Reconciliation ran `REJECT_DUPLICATE` while the
 *   durable record could hold one request per Workflow id; SJ-205 lifted that.)
 */
const ALREADY_RUN: Record<
  z.infer<typeof WorkflowKindSchema>,
  { status: "confirmed" | "failed"; heading: string; message: string }
> = {
  "repair-projection": {
    status: "confirmed",
    heading: "Already ran",
    message:
      "Nothing was started. Lake projection repair already ran to completion for this match, and its reuse policy only re-runs after a failure — so a projection that succeeded is not repeated.",
  },
  "reconcile-pipeline": {
    status: "failed",
    heading: "Refused, and should not have been",
    message:
      "Nothing was started. Temporal refused to reuse this Workflow id, but reconciliation's policy allows a sweep to run again after any close — so this answer and that policy disagree. Check the Workflow rather than asking again.",
  },
  "retry-notification": {
    status: "failed",
    heading: "Refused, and should not have been",
    message:
      "Nothing was started. Temporal refused to reuse this Workflow id, but the notification family's policy allows duplicates — so this answer and that policy disagree. Check the Workflow rather than asking again.",
  },
};

function refused(
  heading: string,
  message: string,
  reason: string | null,
  facts: readonly OperationsOutcomeFact[] = [],
): OperationsConfirmationOutcome {
  return { status: "failed", effect: "none", heading, message, facts, reason };
}

function fromDispatch(
  workflow: z.infer<typeof WorkflowKindSchema>,
  dispatch: z.infer<typeof DispatchSchema> | null,
): OperationsConfirmationOutcome {
  const label = WORKFLOW_LABEL[workflow];
  if (dispatch === null) {
    // `start-authorized` always describes a start, so the router always has a
    // dispatch to report for it. A missing one is a broken contract, and the
    // one thing that must not happen is guessing which way it went.
    return refused(
      "Scout cannot say what happened",
      `The server authorized ${label.toLowerCase()} but reported no dispatch. Check the Workflow before asking again.`,
      "missing-dispatch",
    );
  }
  if (dispatch.outcome === "reached-running") {
    // The operator's answer: the work they asked for is running, named by its
    // run. What this deliberately does NOT say is that this confirmation began
    // it. Temporal's conflict policy joins an execution that is already open
    // and the client's start answer is the same either way, so a console that
    // said "started" here would be claiming an effect it cannot establish —
    // and these Workflow ids are also started by the sweep and the match
    // fan-out, so the run shown genuinely may be one of theirs.
    //
    // `effect` is therefore `none`: it is the non-claiming value, and the
    // alternative would assert authorship on a coin flip.
    return {
      status: "confirmed",
      effect: "none",
      heading: `${label} is running`,
      message: `${label} is running as the run below. Scout does not claim this confirmation began it: Temporal joins a run that is already open and does not report which happened.`,
      facts: [
        { label: "Workflow", value: dispatch.requestedWorkflowId },
        { label: "Run", value: dispatch.runId },
      ],
      reason: "reached-running",
    };
  }
  if (dispatch.outcome === "joined-running") {
    // The one case where the join is PROVEN rather than assumed: the run named
    // here was recorded as accepted for this Workflow id before this
    // confirmation asked Temporal anything, so this call cannot have begun it.
    // Settled, and nothing to offer again: the work the operator wanted is
    // running. Asking again once it closes is a new request, which the durable
    // record now carries.
    return {
      status: "confirmed",
      effect: "none",
      heading: "Already running",
      message: `Nothing new was started. ${label} was already running, and this request joined that run.`,
      facts: [
        { label: "Workflow", value: dispatch.requestedWorkflowId },
        { label: "Run", value: dispatch.runId },
      ],
      reason: "joined-running",
    };
  }
  if (dispatch.outcome === "already-run") {
    const copy = ALREADY_RUN[workflow];
    return {
      status: copy.status,
      effect: "none",
      heading: copy.heading,
      message: copy.message,
      facts: [{ label: "Workflow", value: dispatch.requestedWorkflowId }],
      reason: "already-run",
    };
  }
  return refused(
    "Requested, but not started",
    `The start is durably recorded and Temporal could not be reached, so ${label.toLowerCase()} is not running. ${UNAVAILABLE_RECOVERY[workflow]}`,
    "temporal-unavailable",
    [{ label: "Workflow", value: dispatch.requestedWorkflowId }],
  );
}

function fromOutcome(
  outcome: z.infer<typeof OutcomeSchema>,
  dispatch: z.infer<typeof DispatchSchema> | null,
): OperationsConfirmationOutcome {
  switch (outcome.kind) {
    case "start-authorized":
      return fromDispatch(outcome.workflow, dispatch);
    case "notification-suppressed":
      return {
        status: "confirmed",
        effect: "performed",
        heading: "Notification suppressed",
        message: "The intent is suppressed, with the machine's own reason.",
        facts: [{ label: "Intent", value: outcome.intentKey }],
        reason: null,
      };
    case "delivery-resolved":
      return {
        status: "confirmed",
        effect: "performed",
        heading: "Delivery resolved",
        message: `The attempt is answered. The machine moved the intent to ${outcome.intentState}.`,
        facts: [
          { label: "Intent", value: outcome.intentKey },
          { label: "State", value: outcome.intentState },
        ],
        reason: null,
      };
    case "recovery-policy-released":
      return {
        status: "confirmed",
        effect: "performed",
        heading: "Recovery policy widened",
        message: "The batch now runs under stale-private-only.",
        facts: [{ label: "Batch", value: outcome.recoveryBatchId }],
        reason: null,
      };
    case "already-applied":
      return {
        status: "confirmed",
        effect: "none",
        heading: "Already applied",
        message:
          "The durable machine had already made exactly this change. This confirmation moved nothing.",
        facts: [],
        reason: "already-applied",
      };
    case "machine-refused":
      return refused(
        "The machine refused",
        CONFLICT_COPY[outcome.reason],
        outcome.reason,
      );
    case "not-drivable":
      return refused(
        "Not drivable",
        `A notification Workflow can only pick up an intent that is pending or ready; this one is ${outcome.intentState}.`,
        "not-drivable",
        [
          { label: "Intent", value: outcome.intentKey },
          { label: "State", value: outcome.intentState },
        ],
      );
    case "target-not-found":
      return refused(
        "Target not found",
        `This pipeline has no ${TARGET_LABEL[outcome.target]} with that id.`,
        "target-not-found",
        [{ label: "Id", value: outcome.id }],
      );
  }
}

/**
 * A stored outcome, replayed.
 *
 * The router answers a second confirmation with the stored outcome and
 * deliberately no dispatch, because this call dispatched nothing. That absence
 * is preserved here rather than filled in: a replay is reported as an earlier
 * answer, never as this confirmation's own.
 */
function fromReplay(stored: unknown): OperationsConfirmationOutcome {
  const parsed = OutcomeSchema.safeParse(stored);
  if (!parsed.success) {
    return refused(
      "Already confirmed",
      "This confirmation has already been used, and Scout cannot read the answer it recorded.",
      "unreadable-replay",
    );
  }
  const replayed = fromOutcome(parsed.data, null);
  if (parsed.data.kind === "start-authorized") {
    // A stored `start-authorized` says a start was authorized, and nothing
    // about whether it was ever dispatched — that happened after the
    // transaction, outside what the intent records.
    return {
      status: "confirmed",
      effect: "none",
      heading: "Already confirmed",
      message: `This confirmation was already used to authorize ${WORKFLOW_LABEL[parsed.data.workflow].toLowerCase()}. Whether that start reached Temporal is not recorded on the intent — check the Workflow.`,
      facts: [],
      reason: "already-consumed",
    };
  }
  return {
    ...replayed,
    effect: "none",
    heading:
      replayed.status === "confirmed"
        ? `${replayed.heading} earlier`
        : replayed.heading,
    message: `This confirmation was already used. ${replayed.message}`,
    reason: replayed.reason ?? "already-consumed",
  };
}

export function classifyOperationsConfirmation(
  result: unknown,
): OperationsConfirmationOutcome {
  const parsed = ConfirmResultSchema.safeParse(result);
  if (!parsed.success) {
    return refused(
      "Scout cannot read that answer",
      "The operations API answered with something this console does not understand. Check the pipeline directly before asking again.",
      "unreadable",
    );
  }
  if (parsed.data.kind === "intent_expired") {
    return refused(
      "This confirmation expired",
      "Nothing was claimed and nothing ran. Prepare the operation again against the current queues.",
      "intent-expired",
    );
  }
  return parsed.data.kind === "already_consumed"
    ? fromReplay(parsed.data.result)
    : fromOutcome(parsed.data.outcome, parsed.data.dispatch);
}
