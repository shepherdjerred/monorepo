import {
  WorkflowRunIdSchema,
  type WorkflowRunId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordAccountId } from "@scout-for-lol/domain/identity/discord.ts";
import {
  recordWorkflowStartAccepted,
  requestWorkflowStart,
} from "#src/database/durable/workflow-start-repository.ts";
import {
  recordDurableWrite,
  type DurableFacts,
} from "#src/durable/match/durable-facts.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";

/**
 * The workflow-start request service.
 *
 * v1 asks Temporal to start work and finds out whether it was accepted; this
 * records both halves. The request row is written BEFORE the start call, so a
 * crash between the two leaves durable evidence that a start was intended —
 * which is the whole point of the table. Acceptance is recorded afterwards,
 * carrying the run id when the client surfaced one.
 *
 * Ordering is the only thing this adds to v1: the start call itself, its
 * arguments, and its error handling are untouched.
 */

export type WorkflowStartRequest = {
  /** Temporal's business key — the workflow id v1 asked for. */
  readonly requestedWorkflowId: string;
  /** The registered workflow name; also the input envelope's kind. */
  readonly workflowType: string;
  /** Where the request came from, e.g. `prematch-parlay-generation`. */
  readonly requestSource: string;
  /** The operator who asked, or null for a system request. */
  readonly requestedBy: DiscordAccountId | null;
  /** The workflow input, wrapped in a version-1 envelope of `workflowType`. */
  readonly input: unknown;
};

function toRunId(value: string | undefined): WorkflowRunId | null {
  return value === undefined ? null : WorkflowRunIdSchema.parse(value);
}

export async function withRecordedWorkflowStart<T>(args: {
  facts: DurableFacts;
  request: WorkflowStartRequest;
  start: () => Promise<T>;
  /** Reads the run id out of the client's answer, when it carries one. */
  runIdOf: (started: T) => string | undefined;
}): Promise<T> {
  const requestedAt = toIsoInstant(args.facts.now());
  await recordDurableWrite(args.facts, "workflow-start-requested", async (db) =>
    requestWorkflowStart(db, {
      requestedWorkflowId: args.request.requestedWorkflowId,
      workflowType: args.request.workflowType,
      requestedBy: args.request.requestedBy,
      requestSource: args.request.requestSource,
      inputPayload: {
        kind: args.request.workflowType,
        version: 1,
        data: args.request.input,
      },
      requestedAt,
      acceptance: null,
    }),
  );

  const started = await args.start();

  await recordDurableWrite(args.facts, "workflow-start-accepted", async (db) =>
    recordWorkflowStartAccepted(db, {
      requestedWorkflowId: args.request.requestedWorkflowId,
      acceptedAt: toIsoInstant(args.facts.now()),
      runId: toRunId(args.runIdOf(started)),
    }),
  );
  return started;
}
