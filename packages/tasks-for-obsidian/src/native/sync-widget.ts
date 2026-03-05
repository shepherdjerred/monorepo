import { isCompletedStatus } from "../domain/status";
import type { Task, TaskId } from "../domain/types";
import { isOverdue, isToday } from "../lib/dates";
import { updateWidgetData } from "./widget-bridge";

export function syncWidgetData(tasks: Map<TaskId, Task>): void {
  const allTasks = [...tasks.values()];
  const todayTasks = allTasks
    .filter(
      (t) =>
        !isCompletedStatus(t.status) && (isToday(t.due) || isOverdue(t.due)),
    )
    .slice(0, 8)
    .map((t) => ({
      id: String(t.id),
      title: t.title,
      priority: t.priority,
      completed: isCompletedStatus(t.status),
      due: t.due,
      project: t.projects[0] ? String(t.projects[0]) : undefined,
    }));

  const stats = {
    total: allTasks.filter((t) => !isCompletedStatus(t.status)).length,
    overdue: allTasks.filter(
      (t) => !isCompletedStatus(t.status) && isOverdue(t.due),
    ).length,
    today: allTasks.filter(
      (t) => !isCompletedStatus(t.status) && isToday(t.due),
    ).length,
  };

  updateWidgetData({ todayTasks, stats });
}
