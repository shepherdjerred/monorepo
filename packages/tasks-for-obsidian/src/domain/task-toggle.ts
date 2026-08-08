import { completionTargetDate, isRecurring } from "./recurrence";
import type { Task } from "./types";
import type { RecurringCompletionRestore } from "tasknotes-types/v2";

export type RecurringToggleExecution = {
  readonly date: string;
  readonly completed: boolean;
  readonly restore: RecurringCompletionRestore | null;
};

export type TaskToggleExecution<Result> = {
  readonly result: Result;
  readonly recurring: RecurringToggleExecution | null;
};

type PendingRestore =
  | RecurringCompletionRestore
  | Promise<RecurringCompletionRestore | undefined>
  | undefined;

/**
 * Executes the one toggle intent computed at tap time. Keeping the target date
 * and absolute completion state together prevents an offline replay from
 * toggling a different recurring occurrence after the server advances it.
 */
export async function executeTaskToggle<Result>(
  task: Task | undefined,
  occurrenceDate: string | undefined,
  scope: "occurrence" | "task-status",
  operations: {
    readonly toggleStatus: () => Promise<Result>;
    readonly setInstanceComplete: (
      date: string,
      completed: boolean,
      restore?: RecurringCompletionRestore,
    ) => Promise<Result>;
    readonly pendingRestore?: PendingRestore;
  },
): Promise<TaskToggleExecution<Result>> {
  if (task === undefined || scope === "task-status" || !isRecurring(task)) {
    return {
      result: await operations.toggleStatus(),
      recurring: null,
    };
  }

  const date = occurrenceDate ?? completionTargetDate(task);
  const completed = !task.completeInstances.includes(date);
  const restore = completed
    ? recurringCompletionRestore(task, date)
    : ((await operations.pendingRestore) ?? null);
  return {
    result: await operations.setInstanceComplete(
      date,
      completed,
      restore ?? undefined,
    ),
    recurring: {
      date,
      completed,
      restore,
    },
  };
}

export function recurringCompletionRestore(
  task: Task,
  date: string,
): RecurringCompletionRestore {
  if (!isRecurring(task) || task.recurrence === undefined) {
    throw new TypeError("recurring completion restore requires a recurrence");
  }
  return {
    scheduled: task.scheduled ?? null,
    due: task.due ?? null,
    recurrence: task.recurrence,
    skipped: task.skippedInstances.includes(date),
  };
}
