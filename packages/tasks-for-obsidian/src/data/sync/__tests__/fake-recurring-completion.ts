import {
  updateToNextScheduledOccurrence,
  type CompleteInstanceRequest,
} from "tasknotes-types/v2";

import type { Task } from "../../../domain/types";

function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

function advanceSchedule(
  existing: Task,
  updated: Task,
  timestamp: number,
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
    today: localDay(timestamp),
  });
  if (next.scheduled === null) {
    Reflect.deleteProperty(updated, "scheduled");
  } else {
    updated.scheduled = next.scheduled;
  }
  if (next.due === null) {
    Reflect.deleteProperty(updated, "due");
  } else {
    updated.due = next.due;
  }
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
    advanceSchedule(existing, updated, timestamp);
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
