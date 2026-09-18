import type { Db } from "#src/database/index.ts";
import type {
  IsoInstant,
  WorkflowRunId,
  WorkflowStartRequestId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutWorkflowStartRecordSchema,
  type ScoutWorkflowStartRecord,
  type ScoutWorkflowStartRequest,
} from "@scout-for-lol/domain/recovery/workflow-start.ts";
import {
  acceptWorkflowStart,
  decideWorkflowStartRequest,
  resolveWorkflowStartLostInsert,
  type WorkflowStartRequestContext,
} from "@scout-for-lol/domain/recovery/workflow-start-transitions.ts";
import {
  scoutWorkflowStartRecordToRow,
  scoutWorkflowStartRowToRecord,
} from "#src/database/durable/workflow-start-row.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Repository for ScoutWorkflowStart.
 *
 * requestWorkflowStart is record-or-adopt by the requested workflow id, with
 * the domain deciding which: a request while one is still in flight for that
 * workflow id adopts it (a crashed requester re-requesting the same start
 * finds its own request, including any acceptance already recorded, instead
 * of starting a second workflow); a request after the previous one was
 * accepted is recorded as a new request under a fresh key. Adoption compares
 * what identifies the start — type and input payload — not when or by whom
 * it was re-requested.
 *
 * The partial unique index over in-flight requests is what makes the
 * read-decide-insert safe without a lock: two simultaneous requests for one
 * workflow id both read "nothing in flight" and both try to insert, and the
 * index admits exactly one. The loser's insert is skipped, it re-reads, and
 * the domain adopts the winner — whether that winner is still in flight or
 * was accepted in the gap between the loser's insert and its re-read. Either
 * way it is the same request the loser asked for, and the answer is the one a
 * serialised read would have given.
 */

export type RequestWorkflowStartResult =
  | {
      outcome: "applied";
      record: ScoutWorkflowStartRecord;
      /**
       * The most recently accepted request for this workflow id before this
       * one, so a caller can tell a start that joined that request's still-
       * running execution from one that began a new run.
       */
      latestAccepted: ScoutWorkflowStartRecord | null;
    }
  | {
      outcome: "adopted";
      record: ScoutWorkflowStartRecord;
      latestAccepted: ScoutWorkflowStartRecord | null;
    }
  | { outcome: "conflict"; reason: "request-differs" };

async function workflowStartContext(
  db: Db,
  requestedWorkflowId: string,
): Promise<WorkflowStartRequestContext> {
  const inFlight = await db.scoutWorkflowStart.findFirst({
    where: { requestedWorkflowId, acceptedAt: null },
  });
  const latestAccepted = await db.scoutWorkflowStart.findFirst({
    where: { requestedWorkflowId, acceptedAt: { not: null } },
    orderBy: [{ acceptedAt: "desc" }, { requestId: "desc" }],
  });
  return {
    inFlight:
      inFlight === null ? null : scoutWorkflowStartRowToRecord(inFlight),
    latestAccepted:
      latestAccepted === null
        ? null
        : scoutWorkflowStartRowToRecord(latestAccepted),
  };
}

/**
 * How many times a refused insert is re-read and re-decided before the
 * repository gives up. A lost insert is resolved by the domain from what the
 * re-read shows — the winner in flight, or accepted meanwhile — and only a
 * re-read that shows NEITHER sends this around again. That cannot happen
 * through any write this repository makes, so exhausting the budget is a
 * broken invariant rather than contention.
 */
const LOST_INSERT_ATTEMPTS = 3;

export async function requestWorkflowStart(
  db: Db,
  request: ScoutWorkflowStartRequest,
): Promise<RequestWorkflowStartResult> {
  for (let attempt = 0; attempt < LOST_INSERT_ATTEMPTS; attempt += 1) {
    const context = await workflowStartContext(db, request.requestedWorkflowId);
    const decision = decideWorkflowStartRequest(context, request);
    if (decision.outcome === "conflict") {
      return decision;
    }
    if (decision.outcome === "adopt") {
      return {
        outcome: "adopted",
        record: decision.record,
        latestAccepted: context.latestAccepted,
      };
    }
    const record = ScoutWorkflowStartRecordSchema.parse({
      requestId: crypto.randomUUID(),
      ...request,
      acceptance: null,
    });
    const created = await db.scoutWorkflowStart.createMany({
      data: [scoutWorkflowStartRecordToRow(record)],
      skipDuplicates: true,
    });
    if (created.count === 1) {
      return {
        outcome: "applied",
        record,
        latestAccepted: context.latestAccepted,
      };
    }
    // The in-flight key refused the insert: another request for this
    // workflow id was in flight at the instant of the write. It may still be,
    // or it may have been accepted since; both are the same request as ours,
    // and the domain adopts whichever the re-read shows.
    const raced = await workflowStartContext(db, request.requestedWorkflowId);
    const resolved = resolveWorkflowStartLostInsert({
      before: context,
      after: raced,
      incoming: request,
    });
    if (resolved.outcome === "conflict") {
      return resolved;
    }
    if (resolved.outcome === "adopt") {
      return {
        outcome: "adopted",
        record: resolved.record,
        latestAccepted: raced.latestAccepted,
      };
    }
  }
  throw new Error(
    `Gave up recording a start for ${request.requestedWorkflowId}: ${String(LOST_INSERT_ATTEMPTS)} inserts were each refused as a duplicate while the re-read showed no request in flight and no new acceptance`,
  );
}

export type RecordWorkflowStartAcceptedResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "acceptance-differs" };

/**
 * Record that Temporal accepted the start, on the request that asked for it.
 * Guarded on the not-yet-accepted row; when the guard matches nothing the
 * domain classifies what is there — a retry carrying the identical acceptance
 * is `already-applied`, and a different acceptance for a request that already
 * holds one is a conflict.
 */
export async function recordWorkflowStartAccepted(
  db: Db,
  args: {
    requestId: WorkflowStartRequestId;
    acceptedAt: IsoInstant;
    runId: WorkflowRunId | null;
  },
): Promise<RecordWorkflowStartAcceptedResult> {
  const accepted = await db.scoutWorkflowStart.updateMany({
    where: { requestId: args.requestId, acceptedAt: null },
    data: {
      acceptedAt: dateFromIsoInstant(args.acceptedAt),
      runId: args.runId,
    },
  });
  if (accepted.count === 1) {
    return { outcome: "applied" };
  }
  const existing = await db.scoutWorkflowStart.findUnique({
    where: { requestId: args.requestId },
  });
  if (existing === null) {
    throw new Error(
      `Cannot accept request ${args.requestId}: the start was never requested`,
    );
  }
  const result = acceptWorkflowStart(scoutWorkflowStartRowToRecord(existing), {
    acceptedAt: args.acceptedAt,
    runId: args.runId,
  });
  switch (result.outcome) {
    case "already-applied":
      return { outcome: "already-applied" };
    case "conflict":
      return result;
    case "applied":
      throw new Error(
        `Acceptance update for request ${args.requestId} matched no row yet the request is unaccepted`,
      );
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

/**
 * The workflow id's current request: its in-flight request when one exists,
 * otherwise its most recently accepted one, otherwise null.
 */
export async function getWorkflowStart(
  db: Db,
  args: { requestedWorkflowId: string },
): Promise<ScoutWorkflowStartRecord | null> {
  const context = await workflowStartContext(db, args.requestedWorkflowId);
  return context.inFlight ?? context.latestAccepted;
}
