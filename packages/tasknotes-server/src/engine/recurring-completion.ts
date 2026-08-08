import {
  addDTSTARTToRecurrenceRule,
  updateToNextScheduledOccurrence,
} from "tasknotes-types/v2";
import type {
  FieldMapping,
  RecurringCompletionRestore,
  RecurringTaskCompletePlan,
  TaskInfo,
  TaskPatchOperation,
} from "tasknotes-types/v2";

export type RestoreValidationInput = {
  readonly task: TaskInfo;
  readonly restore: RecurringCompletionRestore;
  readonly date: string;
  readonly today: string;
  readonly maintainDueDateOffset: boolean;
};

export class RecurringRestoreConflictError extends Error {
  constructor(path: string) {
    super(
      `recurring restore for ${path} is stale; refusing to overwrite newer task state`,
    );
    this.name = "RecurringRestoreConflictError";
  }
}

function restoreScheduleSource(
  task: TaskInfo,
  restore: RecurringCompletionRestore,
  date: string,
) {
  return {
    title: task.title,
    recurrence: restore.recurrence,
    ...(restore.scheduled === null ? {} : { scheduled: restore.scheduled }),
    ...(restore.due === null ? {} : { due: restore.due }),
    ...(task.dateCreated === undefined
      ? {}
      : { dateCreated: task.dateCreated }),
    ...(task.recurrence_anchor === undefined
      ? {}
      : { recurrence_anchor: task.recurrence_anchor }),
    complete_instances: (task.complete_instances ?? []).includes(date)
      ? (task.complete_instances ?? [])
      : [...(task.complete_instances ?? []), date],
    skipped_instances: (task.skipped_instances ?? []).filter(
      (entry) => entry !== date,
    ),
  };
}

export function assertRecurringRestoreIsCurrent({
  task,
  restore,
  date,
  today,
  maintainDueDateOffset,
}: RestoreValidationInput): void {
  const scheduleSource = restoreScheduleSource(task, restore, date);
  const next = updateToNextScheduledOccurrence(
    scheduleSource,
    maintainDueDateOffset,
    { today },
  );
  const expectedScheduled = next.scheduled ?? restore.scheduled ?? undefined;
  const expectedDue = next.due ?? restore.due ?? undefined;
  const expectedRecurrence =
    addDTSTARTToRecurrenceRule({
      recurrence: restore.recurrence,
      ...(restore.scheduled === null ? {} : { scheduled: restore.scheduled }),
      ...(task.dateCreated === undefined
        ? {}
        : { dateCreated: task.dateCreated }),
    }) ?? restore.recurrence;
  const recurrenceMatches = task.recurrence === expectedRecurrence;
  const targetIsNotSkipped = !(task.skipped_instances ?? []).includes(date);
  if (
    !targetIsNotSkipped ||
    !recurrenceMatches ||
    task.scheduled !== expectedScheduled ||
    (restore.due === null ? task.due !== undefined : task.due !== expectedDue)
  ) {
    throw new RecurringRestoreConflictError(task.path);
  }
}

export function recurringRestoreMatchesCurrent(
  task: TaskInfo,
  restore: RecurringCompletionRestore,
  date: string,
): boolean {
  return (
    task.recurrence === restore.recurrence &&
    (restore.scheduled === null
      ? task.scheduled === undefined
      : task.scheduled === restore.scheduled) &&
    (restore.due === null
      ? task.due === undefined
      : task.due === restore.due) &&
    (restore.skipped
      ? (task.skipped_instances ?? []).includes(date)
      : !(task.skipped_instances ?? []).includes(date))
  );
}

function withInstanceMembership(
  instances: readonly string[] | undefined,
  date: string,
  included: boolean,
): string[] {
  const withoutTarget = (instances ?? []).filter((entry) => entry !== date);
  return included ? [...withoutTarget, date] : withoutTarget;
}

export function recurringCompletionRestorePatch(
  restore: RecurringCompletionRestore,
  date: string,
  skippedInstances: readonly string[] | undefined,
  fieldMapping: FieldMapping,
): TaskPatchOperation[] {
  return [
    {
      op: "set",
      field: fieldMapping.recurrence,
      value: restore.recurrence,
    },
    restore.scheduled === null
      ? { op: "delete", field: fieldMapping.scheduled }
      : {
          op: "set",
          field: fieldMapping.scheduled,
          value: restore.scheduled,
        },
    restore.due === null
      ? { op: "delete", field: fieldMapping.due }
      : { op: "set", field: fieldMapping.due, value: restore.due },
    {
      op: "set",
      field: fieldMapping.skippedInstances,
      value: withInstanceMembership(skippedInstances, date, restore.skipped),
    },
  ];
}

function setTaskDate(
  task: TaskInfo,
  field: "scheduled" | "due",
  value: string | undefined,
): void {
  if (value === undefined) {
    Reflect.deleteProperty(task, field);
  } else if (field === "scheduled") {
    task.scheduled = value;
  } else {
    task.due = value;
  }
}

export function useDeterministicRecurringSchedule(
  plan: RecurringTaskCompletePlan,
  original: TaskInfo,
  today: string,
  maintainDueDateOffset: boolean,
): void {
  // Uncompleting clears the targeted instance but must not advance the
  // already-advanced schedule. This also covers bodyless toggles and older
  // clients that send completed:false without a restore snapshot.
  if (!plan.newComplete) {
    setTaskDate(plan.updatedTask, "scheduled", original.scheduled);
    setTaskDate(plan.updatedTask, "due", original.due);
    return;
  }

  const scheduleSource: TaskInfo = { ...plan.updatedTask };
  setTaskDate(scheduleSource, "scheduled", original.scheduled);
  setTaskDate(scheduleSource, "due", original.due);
  const next = updateToNextScheduledOccurrence(
    scheduleSource,
    maintainDueDateOffset,
    { today },
  );

  // Match the model plan's behavior when no future occurrence exists: retain
  // the original value. The only difference is that its implicit wall-clock
  // `today` is replaced with the repository's injected clock.
  setTaskDate(
    plan.updatedTask,
    "scheduled",
    next.scheduled ?? original.scheduled,
  );
  setTaskDate(plan.updatedTask, "due", next.due ?? original.due);
}
