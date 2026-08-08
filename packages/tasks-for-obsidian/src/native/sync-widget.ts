import type { Task, TaskId } from "../domain/types";
import { deriveWidgetDataEnvelope } from "../domain/widget-data";
import { localTodayYmd } from "../domain/recurrence";
import { updateWidgetData } from "./widget-bridge";

export function syncWidgetData(tasks: ReadonlyMap<TaskId, Task>): void {
  const now = new Date();
  updateWidgetData(
    deriveWidgetDataEnvelope(
      [...tasks.values()],
      localTodayYmd(now),
      now.toISOString(),
    ),
  );
}
