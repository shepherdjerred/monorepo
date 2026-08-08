import type { Task, TaskId } from "../domain/types";
import { Platform } from "react-native";
import {
  deriveWidgetDataEnvelope,
  WIDGET_HORIZON_DAYS,
} from "../domain/widget-data";
import { localTodayYmd } from "../domain/recurrence";
import { updateWidgetData } from "./widget-bridge";

export function syncWidgetData(tasks: ReadonlyMap<TaskId, Task>): void {
  if (Platform.OS !== "ios") return;
  const now = new Date();
  updateWidgetData(
    deriveWidgetDataEnvelope(
      [...tasks.values()],
      localTodayYmd(now),
      now.toISOString(),
      WIDGET_HORIZON_DAYS,
    ),
  );
}
