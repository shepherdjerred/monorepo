import { continueAsNew, setHandler, workflowInfo } from "@temporalio/workflow";
import {
  ScoutReportLakeInputSchema,
  ScoutReportRunInputSchema,
  ScoutReportScheduleReconcilerInputSchema,
  type ScoutReportLakeInput,
  type ScoutReportRunInput,
  type ScoutReportScheduleReconcilerInput,
  type ScoutWorkflowStatus,
} from "#src/contracts.ts";
import { reconcileReportSchedulesSignal } from "#src/signals.ts";
import { backgroundActivities, lakeActivities } from "./activity-options.ts";

export async function scoutReportLakeWorkflow(
  rawInput: ScoutReportLakeInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutReportLakeInputSchema.parse(rawInput);
  await lakeActivities(input.stage).runReportLakeJob(input);
  return "completed";
}

export async function scoutReportRunWorkflow(
  rawInput: ScoutReportRunInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutReportRunInputSchema.parse(rawInput);
  await backgroundActivities(input.stage).runReport(input);
  return "completed";
}

export async function scoutReportScheduleReconcilerWorkflow(
  rawInput: ScoutReportScheduleReconcilerInput,
): Promise<{ status: ScoutWorkflowStatus; processed: number }> {
  const input = ScoutReportScheduleReconcilerInputSchema.parse(rawInput);
  let signalled = true;
  let processed = 0;
  setHandler(reconcileReportSchedulesSignal, () => {
    signalled = true;
  });

  while (signalled) {
    signalled = false;
    const result = await backgroundActivities(
      input.stage,
    ).drainReportScheduleOutbox(input);
    processed += result.processed;
    if (result.remaining > 0) {
      signalled = true;
    }
    if (workflowInfo().continueAsNewSuggested) {
      await continueAsNew<typeof scoutReportScheduleReconcilerWorkflow>(input);
    }
  }
  return { status: "completed", processed };
}
