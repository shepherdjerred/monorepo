import {
  condition,
  continueAsNew,
  getExternalWorkflowHandle,
  isCancellation,
  setHandler,
  sleep,
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
    const page = await fetchHistoryPage(
      activities.fetchInitialHistoryPage,
      input,
    );
    if (page === undefined) continue;
    if (page.nextAttemptAt !== undefined) {
      await sleepUntil(page.nextAttemptAt);
      runRequested = true;
      continue;
    }
    if (page.nextAction === "fold-lake") {
      await lakeActivities(input.stage).runReportLakeJob({
        stage: input.stage,
        kind: "fold",
      });
    }
    const next = nextHistoryInput(input, page);
    input = next.input;
    runRequested = !next.complete;
    if (
      next.input.pagesInCurrentRun >= 100 ||
      workflowInfo().continueAsNewSuggested
    ) {
      await continueAsNew<typeof scoutInitialHistoryWorkflow>({
        ...input,
        runOnStart: runRequested,
        pagesInCurrentRun: 0,
      });
    }
  }
}

async function fetchHistoryPage(
  fetchPage: (input: ScoutInitialHistoryInput) => Promise<InitialHistoryPage>,
  input: ScoutInitialHistoryInput,
): Promise<InitialHistoryPage | undefined> {
  try {
    return await fetchPage(input);
  } catch (error: unknown) {
    if (isCancellation(error)) throw error;
    return undefined;
  }
}

type InitialHistoryPage = Awaited<
  ReturnType<ReturnType<typeof backgroundActivities>["fetchInitialHistoryPage"]>
>;

async function sleepUntil(nextAttemptAt: string): Promise<void> {
  const delayMs = Math.max(0, new Date(nextAttemptAt).getTime() - Date.now());
  if (delayMs > 0) await sleep(delayMs);
}

function nextHistoryInput(
  input: ScoutInitialHistoryInput,
  page: InitialHistoryPage,
): { readonly input: ScoutInitialHistoryInput; readonly complete: boolean } {
  const pagesProcessed = input.pagesProcessed + 1;
  const pagesInCurrentRun = input.pagesInCurrentRun + 1;
  if (page.complete) {
    return {
      input: {
        stage: input.stage,
        puuid: input.puuid,
        pagesProcessed,
        pagesInCurrentRun,
      },
      complete: true,
    };
  }
  if (page.nextCursor === undefined) {
    throw new Error("An incomplete initial-history page must return a cursor");
  }
  return {
    input: {
      stage: input.stage,
      puuid: input.puuid,
      cursor: page.nextCursor,
      pagesProcessed,
      pagesInCurrentRun,
    },
    complete: false,
  };
}

export async function scoutIngestionReconciliationWorkflow(
  rawInput: ScoutIngestionReconciliationInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutIngestionReconciliationInputSchema.parse(rawInput);
  const reconciliation = await backgroundActivities(
    input.stage,
  ).reconcileIngestion(input);
  await startInitialHistoryChildren(
    input.stage,
    reconciliation.initialHistoryPuuids,
  );
  await startDetachedChildren(input.stage, reconciliation.detachedWorks);
  await startInteractiveChildren(input.stage, reconciliation.interactiveRuns);
  return "completed";
}

async function startInitialHistoryChildren(
  stage: ScoutInitialHistoryInput["stage"],
  puuids: readonly string[],
): Promise<void> {
  for (const puuid of puuids) {
    try {
      await startChild(scoutInitialHistoryWorkflow, {
        workflowId: scoutInitialHistoryWorkflowId(stage, puuid),
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [{ stage, puuid, pagesProcessed: 0, pagesInCurrentRun: 0 }],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
      await getExternalWorkflowHandle(
        scoutInitialHistoryWorkflowId(stage, puuid),
      ).signal(requestInitialHistoryRunSignal);
    }
  }
}

async function startDetachedChildren(
  stage: ScoutDetachedWorkInput["stage"],
  works: readonly DetachedWork[],
): Promise<void> {
  for (const work of works) {
    try {
      await startChild(scoutDetachedWorkWorkflow, {
        workflowId: scoutDetachedWorkWorkflowId(stage, work.kind, work.workId),
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [{ stage, kind: work.kind, workId: work.workId }],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}

async function startInteractiveChildren(
  stage: ScoutIngestionReconciliationInput["stage"],
  runs: readonly InteractiveRun[],
): Promise<void> {
  for (const run of runs) {
    try {
      await startChild(scoutInteractiveRunWorkflow, {
        workflowId: scoutInteractiveWorkflowId(
          stage,
          run.kind,
          run.databaseRunId,
        ),
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [{ stage, ...run }],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}

type InteractiveRun = {
  readonly kind: "explore" | "report-ai";
  readonly databaseRunId: string;
};

type DetachedWork = {
  readonly kind: "prediction-ingest" | "parlay-generation";
  readonly workId: string;
};

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
