import {
  condition,
  continueAsNew,
  getExternalWorkflowHandle,
  isCancellation,
  setHandler,
  startChild,
  workflowInfo,
} from "@temporalio/workflow";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import {
  ScoutBackgroundJobInputSchema,
  ScoutDetachedWorkInputSchema,
  ScoutIngestionReconciliationInputSchema,
  ScoutInitialHistoryInputSchema,
  type ScoutBackgroundJobInput,
  type ScoutDetachedWorkInput,
  type ScoutIngestionReconciliationInput,
  type ScoutInitialHistoryInput,
  type ScoutWorkflowStatus,
} from "#src/contracts.ts";
import { backgroundActivities } from "./activity-options.ts";
import { lakeActivities } from "./activity-options.ts";
import {
  scoutInitialHistoryWorkflowId,
  scoutDetachedWorkWorkflowId,
  scoutInteractiveWorkflowId,
  scoutTaskQueues,
} from "#src/identifiers.ts";
import { requestInitialHistoryRunSignal } from "#src/signals.ts";
import { scoutInteractiveRunWorkflow } from "./interactive.ts";

export async function scoutInitialHistoryWorkflow(
  rawInput: ScoutInitialHistoryInput,
): Promise<never> {
  let input = ScoutInitialHistoryInputSchema.parse(rawInput);
  let runRequested = input.runOnStart ?? true;
  setHandler(requestInitialHistoryRunSignal, () => {
    runRequested = true;
  });
  const activities = backgroundActivities(input.stage);
  for (;;) {
    await condition(() => runRequested);
    runRequested = false;
    let page: Awaited<ReturnType<typeof activities.fetchInitialHistoryPage>>;
    try {
      page = await activities.fetchInitialHistoryPage(input);
    } catch (error: unknown) {
      if (isCancellation(error)) throw error;
      continue;
    }
    const pagesProcessed = input.pagesProcessed + 1;
    const pagesInCurrentRun = input.pagesInCurrentRun + 1;
    if (page.nextAction === "fold-lake") {
      await lakeActivities(input.stage).runReportLakeJob({
        stage: input.stage,
        kind: "fold",
      });
    }
    if (page.complete) {
      input = {
        stage: input.stage,
        puuid: input.puuid,
        pagesProcessed,
        pagesInCurrentRun,
      };
      if (pagesInCurrentRun >= 100 || workflowInfo().continueAsNewSuggested) {
        await continueAsNew<typeof scoutInitialHistoryWorkflow>({
          ...input,
          runOnStart: runRequested,
          pagesInCurrentRun: 0,
        });
      }
      continue;
    }
    runRequested = true;
    if (page.nextCursor === undefined) {
      throw new Error(
        "An incomplete initial-history page must return a cursor",
      );
    }
    input = {
      stage: input.stage,
      puuid: input.puuid,
      cursor: page.nextCursor,
      pagesProcessed,
      pagesInCurrentRun,
    };
    if (pagesInCurrentRun >= 100 || workflowInfo().continueAsNewSuggested) {
      await continueAsNew<typeof scoutInitialHistoryWorkflow>({
        ...input,
        pagesInCurrentRun: 0,
      });
    }
  }
}

export async function scoutIngestionReconciliationWorkflow(
  rawInput: ScoutIngestionReconciliationInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutIngestionReconciliationInputSchema.parse(rawInput);
  const reconciliation = await backgroundActivities(
    input.stage,
  ).reconcileIngestion(input);
  for (const puuid of reconciliation.initialHistoryPuuids) {
    try {
      await startChild(scoutInitialHistoryWorkflow, {
        workflowId: scoutInitialHistoryWorkflowId(input.stage, puuid),
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(input.stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [
          {
            stage: input.stage,
            puuid,
            pagesProcessed: 0,
            pagesInCurrentRun: 0,
          },
        ],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
      await getExternalWorkflowHandle(
        scoutInitialHistoryWorkflowId(input.stage, puuid),
      ).signal(requestInitialHistoryRunSignal);
    }
  }
  for (const work of reconciliation.detachedWorks) {
    try {
      await startChild(scoutDetachedWorkWorkflow, {
        workflowId: scoutDetachedWorkWorkflowId(
          input.stage,
          work.kind,
          work.workId,
        ),
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(input.stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [{ stage: input.stage, ...work }],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
  for (const run of reconciliation.interactiveRuns) {
    try {
      await startChild(scoutInteractiveRunWorkflow, {
        workflowId: scoutInteractiveWorkflowId(
          input.stage,
          run.kind,
          run.databaseRunId,
        ),
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(input.stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [{ stage: input.stage, ...run }],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
  return "completed";
}

export async function scoutBackgroundJobWorkflow(
  rawInput: ScoutBackgroundJobInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutBackgroundJobInputSchema.parse(rawInput);
  await backgroundActivities(input.stage).runBackgroundJob(input);
  return "completed";
}

export async function scoutDetachedWorkWorkflow(
  rawInput: ScoutDetachedWorkInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutDetachedWorkInputSchema.parse(rawInput);
  if (input.kind === "prediction-ingest") {
    await lakeActivities(input.stage).runDetachedLakeWork(input);
  } else {
    await backgroundActivities(input.stage).runDetachedBackgroundWork(input);
  }
  return "completed";
}
