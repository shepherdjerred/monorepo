import { continueAsNew, workflowInfo } from "@temporalio/workflow";
import {
  ScoutBackgroundJobInputSchema,
  ScoutIngestionReconciliationInputSchema,
  ScoutInitialHistoryInputSchema,
  type ScoutBackgroundJobInput,
  type ScoutIngestionReconciliationInput,
  type ScoutInitialHistoryInput,
  type ScoutWorkflowStatus,
} from "#src/contracts.ts";
import { backgroundActivities } from "./activity-options.ts";

export async function scoutInitialHistoryWorkflow(
  rawInput: ScoutInitialHistoryInput,
): Promise<{ status: ScoutWorkflowStatus; pagesProcessed: number }> {
  let input = ScoutInitialHistoryInputSchema.parse(rawInput);
  const activities = backgroundActivities(input.stage);
  for (;;) {
    const page = await activities.fetchInitialHistoryPage(input);
    const pagesProcessed = input.pagesProcessed + 1;
    const pagesInCurrentRun = input.pagesInCurrentRun + 1;
    if (page.complete) {
      return { status: "completed", pagesProcessed };
    }
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
  await backgroundActivities(input.stage).reconcileIngestion(input);
  return "completed";
}

export async function scoutBackgroundJobWorkflow(
  rawInput: ScoutBackgroundJobInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutBackgroundJobInputSchema.parse(rawInput);
  await backgroundActivities(input.stage).runBackgroundJob(input);
  return "completed";
}
