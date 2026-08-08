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
export function completionTargetDate(
  task: Task,
  today: string = localTodayYmd(),
): string {
  if (task.recurrenceAnchor === "completion") return today;
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
    modelCalendarDate(day),
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
  return shouldShowRecurringTaskOnDate(
    toRecurringLike(task),
    modelCalendarDate(day),
  );
}

/**
 * The TaskNotes model reads Date arguments with UTC calendar getters. Feed it
 * UTC midnight so a local positive or negative offset cannot shift the task
 * occurrence into an adjacent day. UI-only date parsing remains local.
 */
function modelCalendarDate(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) {
    throw new TypeError(`localDate: invalid YYYY-MM-DD string "${day}"`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new TypeError(`localDate: invalid YYYY-MM-DD string "${day}"`);
  }
  return date;
}

function utcCalendarDay(date: Date): string {
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The next uncompleted and unskipped occurrence STRICTLY AFTER `afterYmd`,
 * scanning up to `horizonDays` ahead. Used by Upcoming and the completion
 * undo toast, which must never advertise a processed date.
 */
export function nextOccurrenceAfter(
  task: Task,
  afterYmd: string,
  horizonDays = 366,
): string | undefined {
  if (!isRecurring(task)) return undefined;
  const start = modelCalendarDate(afterYmd);
  const processed = new Set([
    ...task.completeInstances,
    ...task.skippedInstances,
  ]);
  for (let i = 1; i <= horizonDays; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const ymd = utcCalendarDay(d);
    if (occursOn(task, ymd) && !processed.has(ymd)) return ymd;
  }
  return undefined;
}
