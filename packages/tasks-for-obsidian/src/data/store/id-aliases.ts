import { z } from "zod";

import type { TaskId } from "../../domain/types";
import { taskId } from "../../domain/types";

const AliasesSchema = z.record(z.string(), z.string());

export function parseAliases(raw: string | null): Map<TaskId, TaskId> {
  if (!raw) return new Map();
  try {
    const result = AliasesSchema.safeParse(JSON.parse(raw));
    if (!result.success) return new Map();
    return new Map(
      Object.entries(result.data).map(([from, to]) => [
        taskId(from),
        taskId(to),
      ]),
    );
  } catch {
    return new Map();
  }
}

export function serializeAliases(aliases: ReadonlyMap<TaskId, TaskId>): string {
  const record: Record<string, string> = {};
  for (const [from, to] of aliases) {
    record[String(from)] = String(to);
  }
  return JSON.stringify(record);
}
