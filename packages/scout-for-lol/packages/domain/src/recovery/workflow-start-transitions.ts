import {
  workflowStartLifecycle,
  workflowStartPhase,
  type ScoutWorkflowStartRecord,
  type ScoutWorkflowStartRequest,
  type WorkflowStartAcceptance,
} from "#src/recovery/workflow-start.ts";

/**
 * Pure transitions over workflow start requests.
 *
 * As with the recovery batch machine, illegal transitions are expected
 * concurrency outcomes and return `conflict` with a closed reason; exceptions
 * are reserved for arguments that violate the module's own invariants — a
 * context whose records belong to some other Workflow id, or whose in-flight
 * record is not in flight.
 */

/**
 * What the persistence layer knows about a Workflow id when a request for it
 * arrives. At most one request can be in flight (the lifecycle table admits
 * one in-flight phase, and the persistence key mirrors it); `latestAccepted`
 * is the most recently accepted request, kept so a caller can tell a start
 * that JOINED that request's execution from one that began a new run.
 */
export type WorkflowStartRequestContext = {
  readonly inFlight: ScoutWorkflowStartRecord | null;
  readonly latestAccepted: ScoutWorkflowStartRecord | null;
};

export type WorkflowStartRequestDecision =
  /** Record the incoming request as a new one; nothing is in flight. */
  | { outcome: "record" }
  /** A request for this start is in flight; use it instead of a second one. */
  | { outcome: "adopt"; record: ScoutWorkflowStartRecord }
  /** The Workflow id already names a different start. A broken contract. */
  | { outcome: "conflict"; reason: "request-differs" };

export type WorkflowStartAcceptanceResult =
  | { outcome: "applied"; next: ScoutWorkflowStartRecord }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "acceptance-differs" };

/** Structural equality over JSON-shaped values, key order ignored. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => jsonEqual(value, b[index]))
    );
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const entries = Object.entries(a);
  const other = new Map(Object.entries(b));
  return (
    entries.length === other.size &&
    entries.every(
      ([key, value]) => other.has(key) && jsonEqual(value, other.get(key)),
    )
  );
}

/**
 * Whether two requests describe the same start: the same Workflow type and
 * the same input. When and by whom a start was requested is not part of what
 * it IS, so a re-request from another actor still adopts.
 */
export function sameWorkflowStartIdentity(
  a: ScoutWorkflowStartRequest,
  b: ScoutWorkflowStartRequest,
): boolean {
  return (
    a.workflowType === b.workflowType &&
    jsonEqual(a.inputPayload, b.inputPayload)
  );
}

function requireContextShape(
  context: WorkflowStartRequestContext,
  requestedWorkflowId: string,
): void {
  const { inFlight, latestAccepted } = context;
  if (inFlight !== null) {
    if (inFlight.requestedWorkflowId !== requestedWorkflowId) {
      throw new Error(
        `in-flight request ${inFlight.requestId} belongs to ${inFlight.requestedWorkflowId}, not ${requestedWorkflowId}`,
      );
    }
    if (workflowStartLifecycle(inFlight) !== "in-flight") {
      throw new Error(
        `request ${inFlight.requestId} offered as in flight is ${workflowStartPhase(inFlight)}`,
      );
    }
  }
  if (latestAccepted !== null) {
    if (latestAccepted.requestedWorkflowId !== requestedWorkflowId) {
      throw new Error(
        `accepted request ${latestAccepted.requestId} belongs to ${latestAccepted.requestedWorkflowId}, not ${requestedWorkflowId}`,
      );
    }
    if (workflowStartPhase(latestAccepted) !== "accepted") {
      throw new Error(
        `request ${latestAccepted.requestId} offered as accepted is unaccepted`,
      );
    }
  }
}

/**
 * Decide what a new request for a Workflow id does, given what is already
 * recorded for it.
 *
 * An in-flight request is adopted: the requester wants that start, not a
 * second one, and whichever requester hears back from Temporal first records
 * the acceptance. A terminal request is succeeded: the handoff it recorded is
 * over, so this is a new one. Either way the Workflow id must still name the
 * same start; a different type or input under the same id is a broken
 * derivation, reported as a conflict rather than silently adopted or
 * silently forked.
 */
export function decideWorkflowStartRequest(
  context: WorkflowStartRequestContext,
  incoming: ScoutWorkflowStartRequest,
): WorkflowStartRequestDecision {
  requireContextShape(context, incoming.requestedWorkflowId);
  const { inFlight, latestAccepted } = context;
  if (inFlight !== null) {
    return sameWorkflowStartIdentity(inFlight, incoming)
      ? { outcome: "adopt", record: inFlight }
      : { outcome: "conflict", reason: "request-differs" };
  }
  if (
    latestAccepted !== null &&
    !sameWorkflowStartIdentity(latestAccepted, incoming)
  ) {
    return { outcome: "conflict", reason: "request-differs" };
  }
  return { outcome: "record" };
}

export type WorkflowStartLostInsertDecision =
  /** The request that won the insert — in flight, or accepted since we read. */
  | { outcome: "adopt"; record: ScoutWorkflowStartRecord }
  | { outcome: "conflict"; reason: "request-differs" }
  /** Nothing in the context explains the lost insert; read and try again. */
  | { outcome: "retry" };

/**
 * Decide what a request does when its insert was refused as a duplicate.
 *
 * A refused insert means another request for this Workflow id was in flight
 * at the instant of the write — a concurrent requester won the race for the
 * same start. What the loser sees when it reads again depends on how far the
 * winner got:
 *
 * - the winner is still in flight: adopt it (the ordinary race);
 * - the winner was ACCEPTED between the loser's insert and its re-read, so no
 *   request is in flight and `latestAccepted` is a request the loser had not
 *   seen `before`: adopt that one. This does not contradict the lifecycle
 *   table — `accepted` is terminal for a NEW request — because this is not a
 *   new request. Two callers asked for the same start at the same time; the
 *   winner's acceptance is the start both of them asked for, and recording a
 *   second request now would claim a handoff that never happened;
 * - nothing changed: the context cannot explain the refusal, so the caller
 *   reads again. That is bounded by the caller, not here.
 *
 * In both adopt cases the Workflow id must still name the same start; a
 * different type or input is a broken derivation, reported as a conflict.
 */
export function resolveWorkflowStartLostInsert(args: {
  before: WorkflowStartRequestContext;
  after: WorkflowStartRequestContext;
  incoming: ScoutWorkflowStartRequest;
}): WorkflowStartLostInsertDecision {
  const { before, after, incoming } = args;
  requireContextShape(before, incoming.requestedWorkflowId);
  requireContextShape(after, incoming.requestedWorkflowId);
  const winner =
    after.inFlight ??
    (after.latestAccepted !== null &&
    after.latestAccepted.requestId !== before.latestAccepted?.requestId
      ? after.latestAccepted
      : null);
  if (winner === null) {
    return { outcome: "retry" };
  }
  return sameWorkflowStartIdentity(winner, incoming)
    ? { outcome: "adopt", record: winner }
    : { outcome: "conflict", reason: "request-differs" };
}

function sameAcceptance(
  a: WorkflowStartAcceptance,
  b: WorkflowStartAcceptance,
): boolean {
  return (
    new Date(a.acceptedAt).getTime() === new Date(b.acceptedAt).getTime() &&
    a.runId === b.runId
  );
}

/**
 * Record Temporal's acceptance on a request. A retry carrying the identical
 * acceptance is `already-applied`; a different acceptance for a request that
 * already holds one is a conflict, because overwriting it would destroy the
 * evidence the record exists to hold.
 */
export function acceptWorkflowStart(
  record: ScoutWorkflowStartRecord,
  acceptance: WorkflowStartAcceptance,
): WorkflowStartAcceptanceResult {
  const phase = workflowStartPhase(record);
  switch (phase) {
    case "requested":
      return { outcome: "applied", next: { ...record, acceptance } };
    case "accepted": {
      const current = record.acceptance;
      if (current === null) {
        throw new Error(
          `request ${record.requestId} is accepted yet carries no acceptance`,
        );
      }
      return sameAcceptance(current, acceptance)
        ? { outcome: "already-applied" }
        : { outcome: "conflict", reason: "acceptance-differs" };
    }
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
