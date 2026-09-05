import { defineSignal } from "@temporalio/workflow";
import type { ScoutDuelSeriesChange } from "./contracts.ts";

export const requestStopSignal = defineSignal("requestStop");
export const reconcileReportSchedulesSignal = defineSignal(
  "reconcileReportSchedules",
);
export const requestInitialHistoryRunSignal = defineSignal(
  "requestInitialHistoryRun",
);
export const duelSeriesChangedSignal =
  defineSignal<[ScoutDuelSeriesChange]>("duelSeriesChanged");
