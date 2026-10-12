import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  type Client,
  type WorkflowStartOptions,
} from "@temporalio/client";
import {
  SCOUT_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
  scoutClientMatchDispatchWorkflowId,
  scoutLakeProjectionWorkflowId,
  scoutMatchProcessingWorkflowId,
  scoutNotificationWorkflowId,
  scoutPipelineReconciliationWorkflowId,
  scoutTaskQueues,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import {
  scoutLakeProjectionInputCodec,
  scoutClientMatchDispatchInputCodec,
  scoutMatchProcessingInputCodec,
  scoutNotificationInputCodec,
  scoutPipelineReconciliationInputCodec,
  type ScoutLakeProjectionInput,
  type ScoutClientMatchDispatchBatch,
  type ScoutMatchProcessingInput,
  type ScoutNotificationInput,
  type ScoutPipelineReconciliationInput,
} from "@scout-for-lol/temporal/workflow-contracts";
import { dispatchScoutClientMatchesSignal } from "@scout-for-lol/temporal/signals";
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
 * ENVELOPE, not the flat input. `scoutLakeProjectionInputCodec.serialize`
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
 * uniform, taken from `SCOUT_REUSE_POLICIES` for every start here — the
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
export type ScoutPipelineWorkflowStarter = {
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
export async function startScoutMatchProcessing(
  client: ScoutPipelineWorkflowStarter,
  input: ScoutMatchProcessingInput,
): Promise<{ firstExecutionRunId: string } | null> {
  try {
    return await client.workflow.start(SCOUT_WORKFLOW_NAMES.matchProcessing, {
      ...JOIN_RUNNING_EXECUTION,
      workflowIdReusePolicy:
        SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.matchProcessing],
      workflowId: scoutMatchProcessingWorkflowId(
        input.stage,
        input.riotMatchId,
      ),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      startDelay: SCOUT_CLIENT_MATCH_START_DELAY,
      args: [scoutMatchProcessingInputCodec.serialize(input)],
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
export async function signalScoutClientMatchDispatch(
  client: Client,
  stage: ScoutStage,
  matches: ScoutClientMatchDispatchBatch,
): Promise<void> {
  await client.workflow.signalWithStart(
    SCOUT_WORKFLOW_NAMES.clientMatchDispatch,
    {
      ...JOIN_RUNNING_EXECUTION,
      workflowIdReusePolicy:
        SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.clientMatchDispatch],
      workflowId: scoutClientMatchDispatchWorkflowId(stage),
      taskQueue: scoutTaskQueues(stage).workflow,
      args: [
        scoutClientMatchDispatchInputCodec.serialize({
          stage,
          pending: [],
          lateArrivals: [],
          orderingWatermark: null,
        }),
      ],
      signal: dispatchScoutClientMatchesSignal,
      signalArgs: [matches],
      ...apiStartMetadata(
        stage,
        "Serialize native Scout match observations",
        "Queues complete paired-client matches in completion order behind Riot's first-refusal window.",
      ),
    },
  );
}

export async function startScoutPipelineReconciliation(
  client: ScoutPipelineWorkflowStarter,
  input: ScoutPipelineReconciliationInput,
): Promise<{ firstExecutionRunId: string }> {
  return await client.workflow.start(
    SCOUT_WORKFLOW_NAMES.pipelineReconciliation,
    {
      ...JOIN_RUNNING_EXECUTION,
      workflowIdReusePolicy:
        SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.pipelineReconciliation],
      workflowId: scoutPipelineReconciliationWorkflowId(
        input.stage,
        input.trigger,
      ),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      args: [scoutPipelineReconciliationInputCodec.serialize(input)],
      ...operatorStartMetadata(
        input.stage,
        "Reconcile the Scout durable pipeline",
        "Sweeps for durable match work whose owner dropped it and re-drives each family.",
      ),
    },
  );
}

export async function startScoutLakeProjection(
  client: ScoutPipelineWorkflowStarter,
  input: ScoutLakeProjectionInput,
): Promise<{ firstExecutionRunId: string }> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.lakeProjection, {
    ...JOIN_RUNNING_EXECUTION,
    workflowIdReusePolicy:
      SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.lakeProjection],
    workflowId: scoutLakeProjectionWorkflowId(input.stage, input.riotMatchId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [scoutLakeProjectionInputCodec.serialize(input)],
    ...operatorStartMetadata(
      input.stage,
      "Repair a Scout lake projection",
      "Re-runs report-lake staging for one archived match whose projection never landed.",
    ),
  });
}

export async function startScoutNotification(
  client: ScoutPipelineWorkflowStarter,
  input: ScoutNotificationInput,
): Promise<{ firstExecutionRunId: string }> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.notification, {
    ...JOIN_RUNNING_EXECUTION,
    workflowIdReusePolicy:
      SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.notification],
    workflowId: scoutNotificationWorkflowId(input.stage, input.intentKey),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [scoutNotificationInputCodec.serialize(input)],
    ...operatorStartMetadata(
      input.stage,
      "Re-drive a Scout notification intent",
      "Drives one notification intent that is waiting to be sent.",
    ),
  });
}
