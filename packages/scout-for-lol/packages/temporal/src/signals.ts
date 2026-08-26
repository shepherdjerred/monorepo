import { defineSignal } from "@temporalio/workflow";

export const requestStopSignal = defineSignal("requestStop");
export const reconcileReportSchedulesSignal = defineSignal(
  "reconcileReportSchedules",
);
export const requestInitialHistoryRunSignal = defineSignal(
  "requestInitialHistoryRun",
);
