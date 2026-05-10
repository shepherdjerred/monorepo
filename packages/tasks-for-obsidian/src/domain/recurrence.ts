import { getNextStatus } from "./status";
import type { Task } from "./types";

export function localTodayYmd(now: Date = new Date()): string {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isRecurring(task: Task): boolean {
  return task.recurrence !== undefined && task.recurrence !== "";
}

export function toggleCompleteInstance(
  task: Task,
  today: string = localTodayYmd(),
): Task {
  const completeInstances = task.completeInstances.includes(today)
    ? task.completeInstances.filter((d) => d !== today)
    : [...task.completeInstances, today];
  return { ...task, completeInstances };
}

export function nextOptimistic(
  task: Task,
  today: string = localTodayYmd(),
): Task {
  if (!isRecurring(task)) {
    return { ...task, status: getNextStatus(task.status) };
  }
  return toggleCompleteInstance(task, today);
}
