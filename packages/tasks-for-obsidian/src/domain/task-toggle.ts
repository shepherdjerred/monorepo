import { completionTargetDate, isRecurring } from "./recurrence";
import { getNextStatus, isCompletedStatus } from "./status";
import type { Task } from "./types";
import type { RecurringCompletionRestore } from "tasknotes-types/v2";

export const UNDO_TOAST_MS = 5000;

export type CompletionUndo =
  | {
      readonly kind: "status";
      readonly taskId: Task["id"];
      readonly previousStatus: Task["status"];
    }
  | {
      readonly kind: "recurring-occurrence";
      readonly taskId: Task["id"];
      readonly date: string;
      readonly restore: RecurringCompletionRestore;
    };

export type TaskToggleExecution<Result> = {
  readonly result: Result;
  readonly completionUndo: CompletionUndo | null;
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
    const completionUndo = statusCompletionUndo(task);
    return {
      result: await operations.toggleStatus(),
      completionUndo,
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
    completionUndo:
      completed && restore !== null
        ? {
            kind: "recurring-occurrence",
            taskId: task.id,
            date,
            restore,
          }
        : null,
  };
}

function statusCompletionUndo(task: Task | undefined): CompletionUndo | null {
  if (task === undefined) return null;
  const nextStatus = getNextStatus(task.status);
  if (isCompletedStatus(task.status) || !isCompletedStatus(nextStatus)) {
    return null;
  }
  return {
    kind: "status",
    taskId: task.id,
    previousStatus: task.status,
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

export function successfulCompletionUndos(
  executions: readonly TaskToggleExecution<{ readonly ok: boolean }>[],
): readonly CompletionUndo[] {
  return executions.flatMap((execution) =>
    execution.result.ok && execution.completionUndo !== null
      ? [execution.completionUndo]
      : [],
  );
}
