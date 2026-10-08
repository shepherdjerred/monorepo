import { WorkflowNotFoundError } from "@temporalio/client";
import type { ScoutLegacyMatchCompletionV2Result } from "@scout-for-lol/temporal/activity-contracts";
import type { ScoutMatchRef } from "@scout-for-lol/temporal/pipeline-contracts";
import { createLogger } from "#src/logger.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";

const logger = createLogger("legacy-match-completion");

/** Matches already logged by this process, so each is traced once. */
const logged = new Set<string>();

/**
 * Whether a `legacy-v1` match is finished, for the client-match dispatcher
 * and late binding.
 *
 * Always yes. The v1 pipeline is gone and every one of its executions has
 * closed, so nothing will ever process these matches again. A v1 ingestion
 * that ended FAILED or TERMINATED left stages undone, and that loss is
 * accepted: waiting on a run that can never finish would wedge the serialized
 * dispatcher and make the client outbox retry forever, and the binding
 * projectors late binding runs instead are idempotent. Retention eventually
 * removes the v1 history too, so a missing execution answers the same way.
 *
 * The observed status is logged once per match so each answer is traceable.
 * The result keeps its one-field shape because a still-routed pre-rename
 * bundle parses it strictly.
 */
export async function readLegacyMatchCompletion(
  input: ScoutMatchRef,
): Promise<ScoutLegacyMatchCompletionV2Result> {
  const workflowId = `scout-${input.stage}-match-${input.riotMatchId}`;
  if (!logged.has(workflowId)) {
    logger.info(
      `Treating legacy-v1 match ${input.riotMatchId} as complete; its v1 execution ${workflowId} is ${await observedStatus(workflowId)}`,
    );
    logged.add(workflowId);
  }
  return { completed: true };
}

async function observedStatus(workflowId: string): Promise<string> {
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) return "unobserved (no Temporal client)";
  try {
    const description = await supervisor
      .client()
      .workflow.getHandle(workflowId)
      .describe();
    return description.status.name;
  } catch (error) {
    // The status only explains the answer; it never decides it, so a failed
    // read is reported rather than retried.
    return error instanceof WorkflowNotFoundError
      ? "gone (past retention)"
      : `unobserved (${error instanceof Error ? error.message : String(error)})`;
  }
}
