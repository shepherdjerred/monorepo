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
