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
 * As with the recovery batch machine, what concurrency can produce is an
 * OUTCOME rather than an exception: a Workflow id that already names a
 * different start returns `conflict` with a closed reason, and a request
 * whose handoff another driver already answered returns which answer stands.
 * Exceptions are reserved for arguments that violate the module's own
 * invariants — a context whose records belong to some other Workflow id, or
 * whose in-flight record is not in flight.
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
  /** The offered acceptance is now this request's evidence. */
  | { outcome: "applied"; next: ScoutWorkflowStartRecord }
  /** The request already records this run; the offer adds nothing. */
  | { outcome: "already-applied" }
  /**
   * The request's handoff was already answered, and by a different run than
   * the one offered. The recorded acceptance is returned and stands: the
   * offered run is real, but it is not what this request records.
   */
  | {
      outcome: "answered-by-another-run";
      accepted: WorkflowStartAcceptance;
    };

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
  return latestAccepted !== null &&
    !sameWorkflowStartIdentity(latestAccepted, incoming)
    ? { outcome: "conflict", reason: "request-differs" }
    : { outcome: "record" };
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

/**
 * Whether two acceptances are the same answer.
 *
 * An acceptance says which RUN Temporal gave this request; that is the whole
 * of what it attests to. `acceptedAt` says when the answer was written down,
 * which is observational metadata about the writer rather than part of the
 * fact — the same rule the evidence shapes follow. It has to be, because ONE
 * request can have more than one driver: an adopter drives the request it
 * adopted, so two callers hear the same answer at two instants, and telling
 * the second one that the record disagrees with it would be false.
 */
function sameAcceptance(
  a: WorkflowStartAcceptance,
  b: WorkflowStartAcceptance,
): boolean {
  return a.runId === b.runId;
}

/**
 * Record Temporal's acceptance on a request.
 *
 * An unaccepted request takes the offered acceptance. An accepted one keeps
 * the acceptance it holds — evidence is never overwritten — and the answer
 * says how the offer relates to it: `already-applied` when it names the same
 * run, `answered-by-another-run` when it names a different one.
 *
 * The second of those is a concurrency outcome, not a broken contract, and
 * the difference is what adoption means. A request adopted while in flight
 * has two drivers, each of which asks Temporal itself; normally the conflict
 * policy hands both the same run, and they agree. But if the recorded run
 * closes before the second driver's start lands, that start begins a NEW
 * execution under the family's reuse policy. Both runs are real. The request
 * records the first, because the handoff it names was answered by that one,
 * and the second driver is told so rather than being told it broke an
 * invariant or being allowed to claim an acceptance it did not make.
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
        : { outcome: "answered-by-another-run", accepted: current };
    }
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
