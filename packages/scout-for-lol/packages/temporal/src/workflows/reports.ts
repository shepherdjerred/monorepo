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
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";

export async function scoutReportLakeWorkflow(
  rawInput: ScoutReportLakeInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutReportLakeInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** running report-lake maintenance");
  await lakeActivities(input.stage).runReportLakeJob(input);
  return "completed";
}

export async function scoutReportRunWorkflow(
  rawInput: ScoutReportRunInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutReportRunInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** generating a Scout report");
  await backgroundActivities(input.stage).runReport({
    ...input,
    workflowRunId: workflowInfo().runId,
  });
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
    setWorkflowPhase("**Phase:** reconciling database-backed report schedules");
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
  setWorkflowPhase("**Phase:** report schedules are reconciled");
  return { status: "completed", processed };
}
