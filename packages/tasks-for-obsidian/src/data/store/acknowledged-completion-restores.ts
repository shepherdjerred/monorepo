import { z } from "zod";

import { taskId, type Task, type TaskId } from "../../domain/types";
import type { RecurringCompletionRestore } from "tasknotes-types/v2";
import type { Command } from "../sync/commands";

const CompletionRestoreSchema = z.object({
  scheduled: z.string().nullable(),
  due: z.string().nullable(),
  recurrence: z.string(),
  skipped: z.boolean(),
});
const StoredCompletionRestoreSchema = z.object({
  restore: CompletionRestoreSchema,
});
const CompletionRestoreKeySchema = z.string().superRefine((key, context) => {
  const separator = key.indexOf("\u{0}");
  const date = key.slice(separator + 1);
  if (
    separator <= 0 ||
    key.includes("\u{0}", separator + 1) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    context.addIssue({
      code: "custom",
      message: "Expected a task ID and ISO date separated by NUL",
    });
  }
});
const AcknowledgedCompletionRestoresSchema = z.record(
  CompletionRestoreKeySchema,
  StoredCompletionRestoreSchema,
);

export type StoredCompletionRestore = {
  readonly restore: RecurringCompletionRestore;
};

export function parseAcknowledgedCompletionRestores(
  raw: string | null,
): Map<string, StoredCompletionRestore> {
  if (raw === null) return new Map();
  const parsed: unknown = JSON.parse(raw);
  const result = AcknowledgedCompletionRestoresSchema.parse(parsed);
  const restores = new Map<string, StoredCompletionRestore>();
  for (const [key, value] of Object.entries(result)) {
    restores.set(key, value);
  }
  return restores;
}

export function serializeAcknowledgedCompletionRestores(
  restores: ReadonlyMap<string, StoredCompletionRestore>,
): string {
  return JSON.stringify(Object.fromEntries(restores));
}

export function completionRestoreKey(id: TaskId, date: string): string {
  return `${String(id)}\u{0}${date}`;
}

export function isOccurrenceEdit(
  command: Command,
  currentTask: Task | undefined,
): boolean {
  return (
    command.type === "update" &&
    (currentTask === undefined ||
      (command.payload.recurrence !== undefined &&
        command.payload.recurrence !== currentTask.recurrence) ||
      (command.payload.scheduled !== undefined &&
        command.payload.scheduled !== currentTask.scheduled) ||
      (command.payload.due !== undefined &&
        command.payload.due !== currentTask.due))
  );
}

export function isTaskOccurrenceEdit(
  command: Command,
  targetId: TaskId,
  currentTask: Task | undefined,
): boolean {
  return (
    isOccurrenceEdit(command, currentTask) &&
    command.type === "update" &&
    command.taskId === targetId
  );
}

export function invalidateCompletionRestores(
  restores: ReadonlyMap<string, StoredCompletionRestore>,
  id: TaskId,
): Map<string, StoredCompletionRestore> {
  const next = new Map(restores);
  const keyPrefix = `${String(id)}\u{0}`;
  for (const key of next.keys()) {
    if (key.startsWith(keyPrefix)) next.delete(key);
  }
  return next;
}

export function pruneCompletionRestores(
  restores: ReadonlyMap<string, StoredCompletionRestore>,
  today: string,
  tasks: ReadonlyMap<TaskId, Task>,
): Map<string, StoredCompletionRestore> {
  const next = new Map<string, StoredCompletionRestore>();
  for (const [key, value] of restores) {
    const separator = key.indexOf("\u{0}");
    if (separator === -1 || key.slice(separator + 1) < today) continue;
    if (!tasks.has(taskId(key.slice(0, separator)))) continue;
    next.set(key, value);
  }
  return next;
}

export function invalidateChangedCompletionRestores(
  restores: ReadonlyMap<string, StoredCompletionRestore>,
  previousTasks: ReadonlyMap<TaskId, Task>,
  nextTasks: ReadonlyMap<TaskId, Task>,
): Map<string, StoredCompletionRestore> {
  const next = new Map(restores);
  for (const key of next.keys()) {
    const separator = key.indexOf("\u{0}");
    if (separator === -1) continue;
    const id = taskId(key.slice(0, separator));
    const date = key.slice(separator + 1);
    const previous = previousTasks.get(id);
    const current = nextTasks.get(id);
    if (
      previous !== undefined &&
      current !== undefined &&
      (previous.recurrence !== current.recurrence ||
        previous.scheduled !== current.scheduled ||
        previous.due !== current.due ||
        previous.skippedInstances.includes(date) !==
          current.skippedInstances.includes(date))
    ) {
      next.delete(key);
    }
  }
  return next;
}
