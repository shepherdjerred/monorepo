import {
  getEffectiveTaskStatus,
  resolveOperationTargetDate,
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

/**
 * The occurrence date a completion toggle should target for a RECURRING task.
 *
 * Mirrors the TaskNotes plugin's own `getRecurringTaskActionDate`: a checkbox
 * tap completes the task's currently-SCHEDULED instance (falling back to
 * `due`, then today), NOT the literal calendar day of the tap. Completion-
 * anchored rules ("N days after each completion") DO target today, since the
 * next occurrence is computed from when you complete.
 *
 * The old code hardcoded `localTodayYmd()` here. That silently orphaned every
 * completion made on a non-occurrence day (e.g. paying a rent task that recurs
 * on the 1st while it's the 12th): `getEffectiveTaskStatus` only reads an
 * occurrence as done when that occurrence's OWN date is in `complete_instances`,
 * so a `2026-07-12` entry never checked off the `2026-07-01`/`08-01` instance
 * and the task reappeared as if untouched.
 *
 * Only meaningful for recurring tasks; callers gate on `isRecurring`.
 */
export function completionTargetDate(task: Task): string {
  if (task.recurrenceAnchor === "completion") return localTodayYmd();
  return resolveOperationTargetDate(undefined, task.scheduled, task.due);
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
  const parts = day.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  // `??` only guards null/undefined; a malformed segment yields NaN, which
  // would silently flow into an invalid Date. Fail fast instead.
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new TypeError(`localDate: invalid YYYY-MM-DD string "${day}"`);
  }
  return new Date(y, m - 1, d);
}
