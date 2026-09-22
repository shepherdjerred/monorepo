import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  type Client,
  type WorkflowStartOptions,
} from "@temporalio/client";
import {
  SCOUT_V2_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
  scoutClientMatchDispatchV2WorkflowId,
  scoutLakeProjectionV2WorkflowId,
  scoutMatchProcessingV2WorkflowId,
  scoutNotificationV2WorkflowId,
  scoutPipelineReconciliationV2WorkflowId,
  scoutTaskQueues,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import {
  scoutLakeProjectionV2InputCodec,
  scoutClientMatchDispatchV2InputCodec,
  scoutMatchProcessingV2InputCodec,
  scoutNotificationV2InputCodec,
  scoutPipelineReconciliationV2InputCodec,
  type ScoutLakeProjectionV2Input,
  type ScoutClientMatchDispatchBatchV2,
  type ScoutMatchProcessingV2Input,
  type ScoutNotificationV2Input,
  type ScoutPipelineReconciliationV2Input,
} from "@scout-for-lol/temporal/workflow-contracts-v2";
import { dispatchScoutClientMatchesV2Signal } from "@scout-for-lol/temporal/signals";
import {
  buildTemporalExecutionStartMetadata,
  ExecutionMetadataSchema,
} from "@scout-for-lol/temporal/execution-metadata";
import configuration from "#src/configuration.ts";

/**
 * Client starts for the V2 Workflows an operator can drive.
 *
 * These exist beside `starts.ts` rather than inside it because V2 differs in
 * one way that matters at the call site: the Workflow argument is a VERSIONED
 * ENVELOPE, not the flat input. `scoutLakeProjectionV2InputCodec.serialize`
 * produces `{ kind: "scout-lake-projection-v2-input", ... }`, while the durable
 * `ScoutWorkflowStart` row stores an envelope keyed by the WORKFLOW TYPE. The
 * two envelopes are deliberately different, so the conversion is done here,
 * once, next to the contract it belongs to.
 *
 * The two ID policies answer different questions and are set separately here.
 * The CONFLICT policy governs an execution that is still RUNNING, and every
 * start below joins it rather than racing a second one — an operator asking for
 * work already in flight wants that work, not a duplicate of it. The REUSE
 * policy governs an execution that has CLOSED, and it is per family rather than
 * uniform, taken from `SCOUT_V2_REUSE_POLICIES` for every start here — the
 * same table the reconciliation sweep's child starter reads, and the only
 * place reconciliation's own terms are spelled.
 *
 * Sharing that table is the point. A notification run that completed by
 * recording `unknown-delivery` SUCCEEDED, so refusing to reuse its ID would
 * break the retry arm on its main path: resolving the ambiguity as
 * not-delivered releases the intent to `ready`, and the fresh run that must
 * follow computes the same deterministic ID the closed execution owns. A
 * projection is the opposite shape — a successful one has nothing left to do —
 * so it re-runs only after failure. Spelling either of those here a second time
 * would let the operator path and the sweep drift apart, and the drift would
 * surface only as a start a human asked for and Temporal refused.
 */

/**
 * Join a running execution rather than racing a second one. Orthogonal to
 * reuse: this decides what happens while a run is OPEN.
 */
const JOIN_RUNNING_EXECUTION = {
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

/** Give Riot first refusal before a native payload may become canonical. */
export const SCOUT_CLIENT_MATCH_START_DELAY = "2 minutes";

/**
 * The slice of `Client` these starts need, and the handle field the caller
 * reads back. Structural so a test can pass a plain object and assert the exact
 * policies sent; the real Client satisfies it. Mirrors `ScoutWorkflowStarter`
 * in `starts.ts`, which exists for the same reason.
 */
export type ScoutV2WorkflowStarter = {
  readonly workflow: {
    readonly start: (
      workflowType: string,
      options: WorkflowStartOptions,
    ) => Promise<{ firstExecutionRunId: string }>;
  };
};

function operatorStartMetadata(
  stage: ScoutStage,
  summary: string,
  description: string,
) {
  return buildTemporalExecutionStartMetadata({
    metadata: ExecutionMetadataSchema.parse({
      Environment: stage,
      Domain: "scout",
      Trigger: "operator",
      ReleaseCommit: configuration.gitSha,
    }),
    summary,
    description,
  });
}

function apiStartMetadata(
  stage: ScoutStage,
  summary: string,
  description: string,
) {
  return buildTemporalExecutionStartMetadata({
    metadata: ExecutionMetadataSchema.parse({
      Environment: stage,
      Domain: "scout",
      Trigger: "api",
      ReleaseCommit: configuration.gitSha,
    }),
    summary,
    description,
  });
}

/** Start or join the durable per-match pipeline for native-client ingress. */
export async function startScoutMatchProcessingV2(
  client: ScoutV2WorkflowStarter,
  input: ScoutMatchProcessingV2Input,
): Promise<{ firstExecutionRunId: string } | null> {
  try {
    return await client.workflow.start(SCOUT_WORKFLOW_NAMES.matchProcessingV2, {
      ...JOIN_RUNNING_EXECUTION,
      workflowIdReusePolicy:
        SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.matchProcessingV2],
      workflowId: scoutMatchProcessingV2WorkflowId(
        input.stage,
        input.riotMatchId,
      ),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      startDelay: SCOUT_CLIENT_MATCH_START_DELAY,
      args: [scoutMatchProcessingV2InputCodec.serialize(input)],
      ...apiStartMetadata(
        input.stage,
        "Ingest a native Scout match observation",
        "Runs the existing post-match pipeline with Riot-first, paired-client gap filling.",
      ),
    });
  } catch (error) {
    // The caller acknowledges the deterministic start conflict only after it
    // reconciles any Custom or duel binding that arrived after this execution
    // passed its binding-dependent stages.
    if (error instanceof WorkflowExecutionAlreadyStartedError) return null;
    throw error;
  }
}

/** Durably enqueue native matches behind the environment's serial dispatcher. */
export async function signalScoutClientMatchDispatchV2(
  client: Client,
  stage: ScoutStage,
  matches: ScoutClientMatchDispatchBatchV2,
): Promise<void> {
  await client.workflow.signalWithStart(
    SCOUT_WORKFLOW_NAMES.clientMatchDispatchV2,
    {
      ...JOIN_RUNNING_EXECUTION,
      workflowIdReusePolicy:
        SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.clientMatchDispatchV2],
      workflowId: scoutClientMatchDispatchV2WorkflowId(stage),
      taskQueue: scoutTaskQueues(stage).workflow,
      args: [
        scoutClientMatchDispatchV2InputCodec.serialize({
          stage,
          pending: [],
          lateArrivals: [],
          orderingWatermark: null,
        }),
      ],
      signal: dispatchScoutClientMatchesV2Signal,
      signalArgs: [matches],
      ...apiStartMetadata(
        stage,
        "Serialize native Scout match observations",
        "Queues complete paired-client matches in completion order behind Riot's first-refusal window.",
      ),
    },
  );
}

export async function startScoutPipelineReconciliationV2(
  client: ScoutV2WorkflowStarter,
  input: ScoutPipelineReconciliationV2Input,
): Promise<{ firstExecutionRunId: string }> {
  return await client.workflow.start(
    SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
    {
      ...JOIN_RUNNING_EXECUTION,
      workflowIdReusePolicy:
        SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2],
      workflowId: scoutPipelineReconciliationV2WorkflowId(
        input.stage,
        input.trigger,
      ),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      args: [scoutPipelineReconciliationV2InputCodec.serialize(input)],
      ...operatorStartMetadata(
        input.stage,
        "Reconcile the Scout durable pipeline",
        "Sweeps for durable match work whose owner dropped it and re-drives each family.",
      ),
    },
  );
}

export async function startScoutLakeProjectionV2(
  client: ScoutV2WorkflowStarter,
  input: ScoutLakeProjectionV2Input,
): Promise<{ firstExecutionRunId: string }> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.lakeProjectionV2, {
    ...JOIN_RUNNING_EXECUTION,
    workflowIdReusePolicy:
      SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.lakeProjectionV2],
    workflowId: scoutLakeProjectionV2WorkflowId(input.stage, input.riotMatchId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [scoutLakeProjectionV2InputCodec.serialize(input)],
    ...operatorStartMetadata(
      input.stage,
      "Repair a Scout lake projection",
      "Re-runs report-lake staging for one archived match whose projection never landed.",
    ),
  });
}

export async function startScoutNotificationV2(
  client: ScoutV2WorkflowStarter,
  input: ScoutNotificationV2Input,
): Promise<{ firstExecutionRunId: string }> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.notificationV2, {
    ...JOIN_RUNNING_EXECUTION,
    workflowIdReusePolicy:
      SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.notificationV2],
    workflowId: scoutNotificationV2WorkflowId(input.stage, input.intentKey),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [scoutNotificationV2InputCodec.serialize(input)],
    ...operatorStartMetadata(
      input.stage,
      "Re-drive a Scout notification intent",
      "Drives one notification intent that is waiting to be sent.",
    ),
  });
}
