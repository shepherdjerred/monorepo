import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type WorkflowHandle,
} from "@temporalio/client";
import type { Client } from "@temporalio/client";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutFixedScheduleId,
  scoutInitialHistoryWorkflowId,
  scoutDetachedWorkWorkflowId,
  scoutInteractiveWorkflowId,
  scoutMatchWorkflowId,
  scoutReportScheduleReconcilerWorkflowId,
  scoutQueueCanaryWorkflowId,
  scoutHallBaselineWorkflowId,
  scoutChallengeRunRecomputeWorkflowId,
  scoutDuelSeriesWorkflowId,
  scoutTaskQueues,
  type ScoutInitialHistoryInput,
  type ScoutDetachedWorkInput,
  type ScoutInteractiveRunInput,
  type ScoutMatchIngestionInput,
  type ScoutReportRunInput,
  type ScoutQueueCanaryInput,
  type ScoutStage,
  type ScoutHallBaselineInput,
  type ScoutChallengeRunRecomputeInput,
  type ScoutDuelSeriesInput,
} from "@scout-for-lol/temporal";
import { duelSeriesChangedSignal } from "@scout-for-lol/temporal/signals";
import { reconcileReportSchedulesSignal } from "@scout-for-lol/temporal/signals";
import { requestInitialHistoryRunSignal } from "@scout-for-lol/temporal/signals";
import {
  buildTemporalExecutionStartMetadata,
  ExecutionMetadataSchema,
  type ExecutionTrigger,
} from "@scout-for-lol/temporal/execution-metadata";
import configuration from "#src/configuration.ts";

const IDEMPOTENT_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

const RESTART_FAILED_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

const RESTART_CLOSED_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

function startMetadata(
  stage: ScoutStage,
  trigger: ExecutionTrigger,
  summary: string,
  description: string,
) {
  return buildTemporalExecutionStartMetadata({
    metadata: ExecutionMetadataSchema.parse({
      Environment: stage,
      Domain: "scout",
      Trigger: trigger,
      ReleaseCommit: configuration.gitSha,
    }),
    summary,
    description,
  });
}

export async function startScoutMatchIngestion(
  client: Client,
  input: ScoutMatchIngestionInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.matchIngestion, {
    ...RESTART_FAILED_START_POLICIES,
    workflowId: scoutMatchWorkflowId(input.stage, input.matchId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
    ...startMetadata(
      input.stage,
      "workflow",
      "Ingest Scout match",
      "Coordinates durable ingestion for one completed match.",
    ),
  });
}

export async function startScoutQueueCanary(
  client: Client,
  input: ScoutQueueCanaryInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.queueCanary, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutQueueCanaryWorkflowId(input.stage, input.canaryId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
    ...startMetadata(
      input.stage,
      "operator",
      "Probe Scout task queues",
      "Checks that every Scout workflow and Activity queue is available.",
    ),
  });
}

export async function startScoutInitialHistory(
  client: Client,
  input: ScoutInitialHistoryInput,
): Promise<WorkflowHandle> {
  return await client.workflow.signalWithStart(
    SCOUT_WORKFLOW_NAMES.initialHistory,
    {
      ...IDEMPOTENT_START_POLICIES,
      workflowId: scoutInitialHistoryWorkflowId(input.stage, input.puuid),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      args: [input],
      signal: requestInitialHistoryRunSignal,
      signalArgs: [],
      ...startMetadata(
        input.stage,
        "workflow",
        "Import initial Scout history",
        "Coordinates the durable initial match-history import for one linked account.",
      ),
    },
  );
}

export async function startScoutDetachedWork(
  client: Client,
  input: ScoutDetachedWorkInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.detachedWork, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutDetachedWorkWorkflowId(
      input.stage,
      input.kind,
      input.workId,
    ),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
    ...startMetadata(
      input.stage,
      "workflow",
      "Run detached Scout work",
      "Runs one durable Scout background or report-lake operation.",
    ),
  });
}

export async function triggerScoutIngestionReconciliationSchedule(
  client: Client,
  stage: ScoutStage,
): Promise<void> {
  await client.schedule
    .getHandle(scoutFixedScheduleId(stage, "ingestion-reconciliation"))
    .trigger();
}

export async function startScoutInteractiveRun(
  client: Client,
  input: ScoutInteractiveRunInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.interactiveRun, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutInteractiveWorkflowId(
      input.stage,
      input.kind,
      input.databaseRunId,
    ),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
    ...startMetadata(
      input.stage,
      "api",
      "Run interactive Scout analysis",
      "Coordinates one user-requested durable Scout analysis.",
    ),
  });
}

export async function startScoutManualReport(
  client: Client,
  input: ScoutReportRunInput & { runId: string; source: "manual" },
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.reportRun, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutInteractiveWorkflowId(
      input.stage,
      "manual-report",
      input.runId,
    ),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
    ...startMetadata(
      input.stage,
      "operator",
      "Run Scout report",
      "Generates one manually requested Scout report.",
    ),
  });
}

export async function signalScoutReportReconciliation(
  client: Client,
  stage: ScoutStage,
): Promise<WorkflowHandle> {
  return await client.workflow.signalWithStart(
    SCOUT_WORKFLOW_NAMES.reportScheduleReconciler,
    {
      ...RESTART_CLOSED_START_POLICIES,
      workflowId: scoutReportScheduleReconcilerWorkflowId(stage),
      taskQueue: scoutTaskQueues(stage).workflow,
      args: [{ stage }],
      signal: reconcileReportSchedulesSignal,
      signalArgs: [],
      ...startMetadata(
        stage,
        "workflow",
        "Reconcile Scout report schedules",
        "Reconciles database-owned Scout report schedules with Temporal.",
      ),
    },
  );
}

export async function startScoutHallBaseline(
  client: Client,
  input: ScoutHallBaselineInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.hallBaseline, {
    ...RESTART_FAILED_START_POLICIES,
    workflowId: scoutHallBaselineWorkflowId(
      input.stage,
      input.guildId,
      input.revision,
    ),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
    ...startMetadata(
      input.stage,
      "api",
      "Build Scout Hall of Fame baseline",
      "Builds every requested Hall record from eligible Scout-known match evidence.",
    ),
  });
}

export async function startScoutChallengeRunRecompute(
  client: Client,
  input: ScoutChallengeRunRecomputeInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(
    SCOUT_WORKFLOW_NAMES.challengeRunRecompute,
    {
      ...RESTART_CLOSED_START_POLICIES,
      workflowId: scoutChallengeRunRecomputeWorkflowId(
        input.stage,
        input.runId,
        input.revision,
      ),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      args: [input],
      ...startMetadata(
        input.stage,
        "api",
        "Recompute Scout challenge run",
        "Pages through Scout evidence and atomically replaces one challenge-run revision.",
      ),
    },
  );
}

export async function startScoutDuelSeries(
  client: Client,
  input: ScoutDuelSeriesInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.duelSeries, {
    ...RESTART_CLOSED_START_POLICIES,
    workflowId: scoutDuelSeriesWorkflowId(input.stage, input.seriesId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
    ...startMetadata(
      input.stage,
      "api",
      "Coordinate Scout duel series",
      "Owns readiness coordination and the durable series deadline.",
    ),
  });
}

export async function signalScoutDuelSeriesChanged(
  client: Client,
  input: ScoutDuelSeriesInput & { readonly requestId: string },
): Promise<WorkflowHandle> {
  return await client.workflow.signalWithStart(
    SCOUT_WORKFLOW_NAMES.duelSeries,
    {
      // Organizer replay decisions can arrive after the original deadline or
      // review workflow has closed. Reuse the stable series ID for an open run,
      // and begin a new run only when the prior execution is already closed.
      ...RESTART_CLOSED_START_POLICIES,
      workflowId: scoutDuelSeriesWorkflowId(input.stage, input.seriesId),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      args: [input],
      signal: duelSeriesChangedSignal,
      signalArgs: [{ requestId: input.requestId }],
      ...startMetadata(
        input.stage,
        "api",
        "Update Scout duel series",
        "Reconciles an accepted or readiness change against the durable series deadline.",
      ),
    },
  );
}
