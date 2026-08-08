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
const AcknowledgedCompletionRestoresSchema = z.record(
  z.string(),
  StoredCompletionRestoreSchema,
);

export type StoredCompletionRestore = {
  readonly restore: RecurringCompletionRestore;
};

export function parseAcknowledgedCompletionRestores(
  raw: string | null,
): Map<string, StoredCompletionRestore> {
  if (raw === null) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  const result = AcknowledgedCompletionRestoresSchema.safeParse(parsed);
  if (!result.success) return new Map();
  const restores = new Map<string, StoredCompletionRestore>();
  for (const [key, value] of Object.entries(result.data)) {
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

export function isOccurrenceEdit(command: Command): boolean {
  return (
    command.type === "update" &&
    (command.payload.recurrence !== undefined ||
      command.payload.scheduled !== undefined ||
      command.payload.due !== undefined)
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
