import {
  getEffectiveTaskStatus,
  shouldShowRecurringTaskOnDate,
} from "tasknotes-types/v2";

import { getNextStatus, isCompletedStatus } from "./status";
import type { Task } from "./types";

/** Domain Task → the model's RecurringTaskLike (snake_case) projection. */
function toRecurringLike(task: Task): {
  title: string;
  recurrence?: string;
  scheduled?: string;
  due?: string;
  dateCreated?: string;
  recurrence_anchor?: "scheduled" | "completion";
  complete_instances: string[];
  skipped_instances: string[];
  status: string;
} {
  return {
    title: task.title,
    ...(task.recurrence === undefined ? {} : { recurrence: task.recurrence }),
    ...(task.scheduled === undefined ? {} : { scheduled: task.scheduled }),
    ...(task.due === undefined ? {} : { due: task.due }),
    ...(task.dateCreated === undefined
      ? {}
      : { dateCreated: task.dateCreated }),
    ...(task.recurrenceAnchor === undefined
      ? {}
      : { recurrence_anchor: task.recurrenceAnchor }),
    complete_instances: [...task.completeInstances],
    skipped_instances: [...task.skippedInstances],
    status: task.status,
  };
}

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

/**
 * Whether the task reads as COMPLETED on the given local day. For recurring
 * tasks this is the per-instance state via the model (the checkbox finally
 * checks when today's instance is done — review finding #4); for plain
 * tasks it's the status.
 */
export function isCompletedOn(task: Task, day: string): boolean {
  if (!isRecurring(task)) return isCompletedStatus(task.status);
  const effective = getEffectiveTaskStatus(
    toRecurringLike(task),
    localDate(day),
    "done",
  );
  return effective === "done";
}

/**
 * Whether a RECURRING task has an occurrence on the given local day, per
 * the model's rrule engine (scheduled-anchored rules finally surface —
 * review finding #4). Non-recurring tasks return false; date-based lists
 * handle them via due/scheduled directly.
 */
export function occursOn(task: Task, day: string): boolean {
  if (!isRecurring(task)) return false;
  return shouldShowRecurringTaskOnDate(toRecurringLike(task), localDate(day));
}

/** Parse a YYYY-MM-DD string as a LOCAL date (never UTC midnight). */
function localDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
