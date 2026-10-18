import {
  ApplicationFailure,
  condition,
  deprecatePatch,
  getExternalWorkflowHandle,
  patched,
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
import { ScoutDiscoveredMatchSchema } from "#src/activity-contracts.ts";
import type { ScoutStage } from "#src/contracts.ts";
import {
  SCOUT_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
  scoutClientMatchDispatchWorkflowId,
  scoutTaskQueues,
} from "#src/identifiers.ts";
import {
  dispatchScoutClientMatchesSignal,
  scoutClientMatchDispatchCompletedSignal,
} from "#src/signals.ts";
import {
  ScoutClientMatchDispatchItemSchema,
  ScoutClientMatchDispatchResultSchema,
  scoutClientMatchDispatchInputCodec,
  type ScoutClientMatchDispatchItem,
} from "#src/workflow-contracts.ts";
import { issuedWorkflowType } from "./generation-rename.ts";

/**
 * The retired chunking gate: every retained discovery recorded it. Remove the
 * `deprecatePatch` call in a release after this one.
 */
export const SCOUT_DISCOVERY_BATCHED_DISPATCH_PATCH =
  "scout-discovery-batched-dispatch";
const DISCOVERY_DISPATCH_BATCH_SIZE = 100;

export const ScoutDispatchableDiscoveredMatchesSchema =
  ScoutDiscoveredMatchSchema.extend({
    gameEndTimestamp: ScoutClientMatchDispatchItemSchema.shape.gameEndTimestamp,
  })
    .array()
    .readonly();

type DispatchableDiscoveredMatch = z.infer<
  typeof ScoutDispatchableDiscoveredMatchesSchema
>[number];
type DispatchResult = ReturnType<
  typeof ScoutClientMatchDispatchResultSchema.parse
>;
export type ScoutDispatchResults = ReadonlyMap<RiotMatchId, DispatchResult>;

export function installMatchDispatchCompletionHandler(): Map<
  RiotMatchId,
  DispatchResult
> {
  const results = new Map<RiotMatchId, DispatchResult>();
  setHandler(scoutClientMatchDispatchCompletedSignal, (rawResult) => {
    const result = ScoutClientMatchDispatchResultSchema.parse(rawResult);
    results.set(result.riotMatchId, result);
  });
  return results;
}

async function ensureClientMatchDispatcher(stage: ScoutStage): Promise<string> {
  const workflowId = scoutClientMatchDispatchWorkflowId(stage);
  try {
    await startChild(
      issuedWorkflowType(SCOUT_WORKFLOW_NAMES.clientMatchDispatch),
      {
        workflowId,
        workflowIdReusePolicy:
          SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.clientMatchDispatch],
        taskQueue: scoutTaskQueues(stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [
          scoutClientMatchDispatchInputCodec.serialize({
            stage,
            pending: [],
            lateArrivals: [],
            orderingWatermark: null,
          }),
        ],
      },
    );
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
  results: ScoutDispatchResults,
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
  const dispatches: ScoutClientMatchDispatchItem[] = matches.map((match) => ({
    riotMatchId: match.riotMatchId,
    sourcePuuid: match.sourcePuuid,
    deliveryMode: match.deliveryMode,
    gameEndTimestamp: match.gameEndTimestamp,
    readyAt,
    completionTargets: [{ workflowId: info.workflowId, runId: info.runId }],
    ...(patched("scout-dispatch-explicit-ordering")
      ? { orderingAssured: true }
      : {}),
  }));
  const dispatcherId = await ensureClientMatchDispatcher(stage);
  const dispatcher = getExternalWorkflowHandle(dispatcherId);
  // The marker still records here so a rollback to a bundle that gates on it
  // replays this history.
  deprecatePatch(SCOUT_DISCOVERY_BATCHED_DISPATCH_PATCH);
  // The receiver can start processing before the next signal arrives. Put
  // earlier matches in earlier chunks so splitting cannot reorder a poll.
  const ordered = dispatches.toSorted(
    (left, right) =>
      left.gameEndTimestamp - right.gameEndTimestamp ||
      left.riotMatchId.localeCompare(right.riotMatchId),
  );
  for (
    let offset = 0;
    offset < ordered.length;
    offset += DISCOVERY_DISPATCH_BATCH_SIZE
  ) {
    await dispatcher.signal(
      dispatchScoutClientMatchesSignal,
      ordered.slice(offset, offset + DISCOVERY_DISPATCH_BATCH_SIZE),
    );
  }
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
