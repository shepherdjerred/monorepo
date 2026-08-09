import {
  addDTSTARTToRecurrenceRule,
  updateToNextScheduledOccurrence,
  type CompleteInstanceRequest,
  type RecurringCompletionRestore,
} from "tasknotes-types/v2";

import type { Task } from "../../../domain/types";
import { ApiError } from "../../../domain/errors";

export function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

function advanceSchedule(
  existing: Task,
  updated: Task,
  completionDate: string,
): void {
  const recurrence = existing.recurrence;
  if (recurrence === undefined) {
    throw new Error("recurring completion fake requires a recurrence");
  }
  const scheduleSource = {
    title: existing.title,
    recurrence,
    ...(existing.scheduled === undefined
      ? {}
      : { scheduled: existing.scheduled }),
    ...(existing.due === undefined ? {} : { due: existing.due }),
    ...(existing.dateCreated === undefined
      ? {}
      : { dateCreated: existing.dateCreated }),
    ...(existing.recurrenceAnchor === undefined
      ? {}
      : { recurrence_anchor: existing.recurrenceAnchor }),
    complete_instances: updated.completeInstances,
    skipped_instances: updated.skippedInstances,
  };
  const next = updateToNextScheduledOccurrence(scheduleSource, true, {
    today: completionDate,
  });
  const scheduled = next.scheduled ?? existing.scheduled;
  if (scheduled === undefined) {
    Reflect.deleteProperty(updated, "scheduled");
  } else {
    updated.scheduled = scheduled;
  }
  const due = next.due ?? existing.due;
  if (due === undefined) {
    Reflect.deleteProperty(updated, "due");
  } else {
    updated.due = due;
  }
}

function fakeRestoredStateMatchesCurrent(
  task: Task,
  restore: RecurringCompletionRestore,
  date: string,
): boolean {
  return (
    !task.completeInstances.includes(date) &&
    task.recurrence === restore.recurrence &&
    task.scheduled === (restore.scheduled ?? undefined) &&
    task.due === (restore.due ?? undefined) &&
    task.skippedInstances.includes(date) === restore.skipped
  );
}

export function fakeRecurringRestoreMatchesCurrent(
  task: Task,
  restore: RecurringCompletionRestore,
  date: string,
): boolean {
  if (fakeRestoredStateMatchesCurrent(task, restore, date)) return true;

  const scheduleSource = {
    title: task.title,
    recurrence: restore.recurrence,
    ...(restore.scheduled === null ? {} : { scheduled: restore.scheduled }),
    ...(restore.due === null ? {} : { due: restore.due }),
    ...(task.dateCreated === undefined
      ? {}
      : { dateCreated: task.dateCreated }),
    ...(task.recurrenceAnchor === undefined
      ? {}
      : { recurrence_anchor: task.recurrenceAnchor }),
    complete_instances: task.completeInstances.includes(date)
      ? task.completeInstances
      : [...task.completeInstances, date],
    skipped_instances: task.skippedInstances.filter((entry) => entry !== date),
  };
  const next = updateToNextScheduledOccurrence(scheduleSource, true, {
    today: date,
  });
  const expectedScheduled = next.scheduled ?? restore.scheduled ?? undefined;
  const expectedDue = next.due ?? restore.due ?? undefined;
  const expectedRecurrence =
    addDTSTARTToRecurrenceRule({
      recurrence: restore.recurrence,
      ...(restore.scheduled === null ? {} : { scheduled: restore.scheduled }),
      ...(restore.due === null ? {} : { due: restore.due }),
      ...(task.dateCreated === undefined
        ? {}
        : { dateCreated: task.dateCreated }),
    }) ?? restore.recurrence;
  return (
    task.recurrence === expectedRecurrence &&
    !task.skippedInstances.includes(date) &&
    task.scheduled === expectedScheduled &&
    (restore.due === null ? task.due === undefined : task.due === expectedDue)
  );
}

export function restoreErrorFor(
  task: Task,
  instance: CompleteInstanceRequest | undefined,
  timestamp: number,
): ApiError | undefined {
  if (instance?.restore === undefined) return undefined;
  const date = instance.date ?? localDay(timestamp);
  return fakeRecurringRestoreMatchesCurrent(task, instance.restore, date)
    ? undefined
    : new ApiError("Recurring restore is stale", 409);
}

export function applyFakeRecurringCompletion(
  existing: Task,
  instance: CompleteInstanceRequest | undefined,
  timestamp: number,
): Task {
  const targetDate = instance?.date ?? localDay(timestamp);
  const has = existing.completeInstances.includes(targetDate);
  const completed = instance?.completed ?? !has;
  if (completed === has && instance?.restore === undefined) {
    return { ...existing };
  }
  const completeInstances = completed
    ? has
      ? [...existing.completeInstances]
      : [...existing.completeInstances, targetDate]
    : existing.completeInstances.filter((date) => date !== targetDate);
  const updated: Task = {
    ...existing,
    completeInstances,
    skippedInstances: completed
      ? existing.skippedInstances.filter((date) => date !== targetDate)
      : existing.skippedInstances,
  };
  if (completed) {
    advanceSchedule(existing, updated, targetDate);
  }
  const restore = instance?.restore;
  if (restore === undefined) return updated;

  updated.recurrence = restore.recurrence;
  if (restore.scheduled === null) {
    Reflect.deleteProperty(updated, "scheduled");
  } else {
    updated.scheduled = restore.scheduled;
  }
  if (restore.due === null) {
    Reflect.deleteProperty(updated, "due");
  } else {
    updated.due = restore.due;
  }
  const withoutSkippedTarget = existing.skippedInstances.filter(
    (date) => date !== targetDate,
  );
  updated.skippedInstances = restore.skipped
    ? [...withoutSkippedTarget, targetDate]
    : withoutSkippedTarget;
  return updated;
}
