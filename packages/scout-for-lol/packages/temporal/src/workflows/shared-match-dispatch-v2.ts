import {
  ApplicationFailure,
  condition,
  getExternalWorkflowHandle,
  setHandler,
  startChild,
  workflowInfo,
} from "@temporalio/workflow";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import type { z } from "zod";
import {
  IsoInstantSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { ScoutDiscoveredMatchV2Schema } from "#src/activity-contracts-v2.ts";
import type { ScoutStage } from "#src/contracts.ts";
import {
  SCOUT_V2_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
  scoutClientMatchDispatchV2WorkflowId,
  scoutTaskQueues,
} from "#src/identifiers.ts";
import {
  dispatchScoutClientMatchesV2Signal,
  scoutClientMatchDispatchCompletedV2Signal,
} from "#src/signals.ts";
import {
  ScoutClientMatchDispatchItemV2Schema,
  ScoutClientMatchDispatchResultV2Schema,
  scoutClientMatchDispatchV2InputCodec,
  type ScoutClientMatchDispatchItemV2,
} from "#src/workflow-contracts-v2.ts";

export const ScoutDispatchableDiscoveredMatchesV2Schema =
  ScoutDiscoveredMatchV2Schema.extend({
    gameEndTimestamp:
      ScoutClientMatchDispatchItemV2Schema.shape.gameEndTimestamp,
  })
    .array()
    .readonly();

type DispatchableDiscoveredMatch = z.infer<
  typeof ScoutDispatchableDiscoveredMatchesV2Schema
>[number];
type DispatchResult = ReturnType<
  typeof ScoutClientMatchDispatchResultV2Schema.parse
>;
export type ScoutDispatchResultsV2 = ReadonlyMap<RiotMatchId, DispatchResult>;

export function installMatchDispatchCompletionHandler(): Map<
  RiotMatchId,
  DispatchResult
> {
  const results = new Map<RiotMatchId, DispatchResult>();
  setHandler(scoutClientMatchDispatchCompletedV2Signal, (rawResult) => {
    const result = ScoutClientMatchDispatchResultV2Schema.parse(rawResult);
    results.set(result.riotMatchId, result);
  });
  return results;
}

async function ensureClientMatchDispatcher(stage: ScoutStage): Promise<string> {
  const workflowId = scoutClientMatchDispatchV2WorkflowId(stage);
  try {
    await startChild(SCOUT_WORKFLOW_NAMES.clientMatchDispatchV2, {
      workflowId,
      workflowIdReusePolicy:
        SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.clientMatchDispatchV2],
      taskQueue: scoutTaskQueues(stage).workflow,
      parentClosePolicy: "ABANDON",
      args: [
        scoutClientMatchDispatchV2InputCodec.serialize({
          stage,
          pending: [],
          lateArrivals: [],
          orderingWatermark: null,
        }),
      ],
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
  return workflowId;
}

/**
 * Hand Riot discoveries to the same environment-wide serializer native
 * observations use, then wait for exact-run acknowledgements before allowing
 * poll maintenance to settle deadlines.
 */
export async function processDiscoveredMatchesThroughDispatcher(
  stage: ScoutStage,
  matches: readonly DispatchableDiscoveredMatch[],
  results: ScoutDispatchResultsV2,
): Promise<{
  readonly childrenStarted: number;
  readonly ownedWholeTail: boolean;
  readonly childFailure?: ApplicationFailure;
}> {
  if (matches.length === 0) {
    return { childrenStarted: 0, ownedWholeTail: true };
  }
  const info = workflowInfo();
  const readyAt = IsoInstantSchema.parse(new Date(Date.now()).toISOString());
  const dispatches: ScoutClientMatchDispatchItemV2[] = matches.map((match) => ({
    riotMatchId: match.riotMatchId,
    sourcePuuid: match.sourcePuuid,
    deliveryMode: match.deliveryMode,
    gameEndTimestamp: match.gameEndTimestamp,
    readyAt,
    completionTargets: [{ workflowId: info.workflowId, runId: info.runId }],
  }));
  const dispatcherId = await ensureClientMatchDispatcher(stage);
  await getExternalWorkflowHandle(dispatcherId).signal(
    dispatchScoutClientMatchesV2Signal,
    dispatches,
  );
  await condition(() =>
    matches.every((match) => results.has(match.riotMatchId)),
  );

  const terminal = matches
    .map((match) => results.get(match.riotMatchId))
    .find((result) => result?.outcome === "terminal-failure");
  return {
    childrenStarted: matches.filter(
      (match) => results.get(match.riotMatchId)?.outcome === "processed",
    ).length,
    ownedWholeTail: terminal === undefined,
    ...(terminal === undefined
      ? {}
      : {
          childFailure: ApplicationFailure.nonRetryable(
            `The shared match dispatcher recorded a terminal failure for ${terminal.riotMatchId}`,
            terminal.failureType ?? "MatchProcessingChildFailure",
          ),
        }),
  };
}
