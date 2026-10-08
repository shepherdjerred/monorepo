import type { ScoutLegacyMatchCompletionV2Result } from "@scout-for-lol/temporal/activity-contracts";
import { ScoutLegacyMatchCompletionV2ResultSchema } from "@scout-for-lol/temporal/activity-contracts";
import type { ScoutMatchRef } from "@scout-for-lol/temporal/pipeline-contracts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";

/**
 * Whether the retired v1 ingestion of a `legacy-v1` match actually finished.
 *
 * Its durable receipts were observability writes that failed open, so they
 * cannot prove the match was finished. The execution can: a v1 ingestion
 * reached COMPLETED only after archival, settlement, delivery, progression and
 * the account cursor loop returned. Every v1 execution has drained, but one
 * that ended FAILED or TERMINATED left stages undone, so draining alone is not
 * completion. The ID is v1's own, `scout-{stage}-match-{matchId}`.
 */
export async function readLegacyMatchCompletion(
  input: ScoutMatchRef,
): Promise<ScoutLegacyMatchCompletionV2Result> {
  const workflowId = `scout-${input.stage}-match-${input.riotMatchId}`;
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    throw new Error(
      `Temporal supervisor is unavailable while reading ${workflowId}`,
    );
  }
  const description = await supervisor
    .client()
    .workflow.getHandle(workflowId)
    .describe();
  return ScoutLegacyMatchCompletionV2ResultSchema.parse({
    completed: description.status.name === "COMPLETED",
  });
}
