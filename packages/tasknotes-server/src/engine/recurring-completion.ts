import { updateToNextScheduledOccurrence } from "tasknotes-types/v2";
import type {
  FieldMapping,
  RecurringCompletionRestore,
  RecurringTaskCompletePlan,
  TaskInfo,
  TaskPatchOperation,
} from "tasknotes-types/v2";

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
