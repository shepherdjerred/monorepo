import type { Task, TaskId } from "../domain/types";
import {
  deriveWidgetDataEnvelope,
  WIDGET_HORIZON_DAYS,
} from "../domain/widget-data";
import { localTodayYmd } from "../domain/recurrence";
import { updateWidgetData } from "./widget-bridge";

export function syncWidgetData(tasks: ReadonlyMap<TaskId, Task>): void {
  const now = new Date();
  try {
    updateWidgetData(
      deriveWidgetDataEnvelope(
        [...tasks.values()],
        localTodayYmd(now),
        now.toISOString(),
        WIDGET_HORIZON_DAYS,
      ),
    );
  } catch (error) {
    console.error(
      `Unable to sync widget data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
