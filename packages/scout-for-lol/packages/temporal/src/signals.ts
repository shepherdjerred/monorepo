import { defineSignal } from "@temporalio/workflow";
import type { ScoutDuelSeriesChange } from "./contracts.ts";
import type {
  ScoutClientMatchDispatchBatchV2,
  ScoutClientMatchDispatchResultV2,
} from "./workflow-contracts-v2.ts";

export const requestStopSignal = defineSignal("requestStop");
export const reconcileReportSchedulesSignal = defineSignal(
  "reconcileReportSchedules",
);
export const requestInitialHistoryRunSignal = defineSignal(
  "requestInitialHistoryRun",
);
export const duelSeriesChangedSignal =
  defineSignal<[ScoutDuelSeriesChange]>("duelSeriesChanged");
export const dispatchScoutClientMatchesV2Signal = defineSignal<
  [ScoutClientMatchDispatchBatchV2]
>("dispatchScoutClientMatchesV2");
export const scoutClientMatchDispatchCompletedV2Signal = defineSignal<
  [ScoutClientMatchDispatchResultV2]
>("scoutClientMatchDispatchCompletedV2");
