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
  const requested = await recordDurableWrite(
    args.facts,
    "workflow-start-requested",
    async (db) =>
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
      }),
  );

  const started = await args.start();

  // Acceptance is keyed by the REQUEST the repository answered with — the one
  // this call recorded, or the in-flight one it adopted — never by a key
  // guessed here. A request that was not recorded (the write failed, or the
  // workflow id already names a different start) has nothing to accept, and
  // that is reported as this write's failure rather than quietly skipped.
  await recordDurableWrite(
    args.facts,
    "workflow-start-accepted",
    async (db) => {
      if (requested === undefined || requested.outcome === "conflict") {
        throw new Error(
          `Cannot record acceptance for ${args.request.requestedWorkflowId}: its request was not recorded`,
        );
      }
      return recordWorkflowStartAccepted(db, {
        requestId: requested.record.requestId,
        acceptedAt: toIsoInstant(args.facts.now()),
        runId: toRunId(args.runIdOf(started)),
      });
    },
  );
  return started;
}
