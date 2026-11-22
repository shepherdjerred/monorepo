import { z } from "zod";
import { mutationsTotal } from "../metrics.ts";
import type { Task } from "../protocol/generated.ts";
import type {
  AuditContext,
  FieldChange,
  MutationAction,
  MutationEntityType,
} from "./auth-types.ts";
import type { UpdateTaskInput } from "./types.ts";

const CursorPayloadSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.string().min(1),
});

const RecordObjectSchema = z.record(z.string(), z.unknown());

export type DecodedMutationCursor = {
  createdAt: Date;
  id: string;
};

export function toRecordSnapshot(
  value: object | null,
): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }
  const parsed = RecordObjectSchema.safeParse(value);
  return parsed.success ? structuredClone(parsed.data) : null;
}

export function computeFieldChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, FieldChange> {
  const prev = before ?? {};
  const next = after ?? {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  keys.delete("updated_at");
  if (before === null) {
    keys.delete("created_at");
  }

  const changes: Record<string, FieldChange> = {};
  for (const key of keys) {
    const fromVal = prev[key] ?? null;
    const toVal = next[key] ?? null;
    if (!Bun.deepEquals(fromVal, toVal)) {
      changes[key] = { from: fromVal, to: toVal };
    }
  }
  return changes;
}

export function inferTaskUpdateAction(
  before: Task,
  after: Task,
  input: UpdateTaskInput,
  hint?: MutationAction,
): MutationAction {
  if (hint !== undefined) {
    return hint;
  }
  if (input.appendComment !== undefined) {
    return "comment_add";
  }
  if (input.removeCommentId !== undefined) {
    return "comment_delete";
  }
  if (input.removeAttachmentId !== undefined) {
    return "attachment_remove";
  }
  if (!before.is_deleted && after.is_deleted) {
    return "delete";
  }
  if (before.is_deleted && !after.is_deleted) {
    return "restore";
  }
  if (!before.completed && after.completed) {
    return "complete";
  }
  return before.completed && !after.completed ? "uncomplete" : "update";
}

export function inferDeleteOrRestoreAction(
  wasDeleted: boolean,
  nowDeleted: boolean,
  hint?: MutationAction,
): MutationAction {
  if (hint !== undefined) {
    return hint;
  }
  if (!wasDeleted && nowDeleted) {
    return "delete";
  }
  return wasDeleted && !nowDeleted ? "restore" : "update";
}

export function encodeMutationCursor(item: {
  created_at: string;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ createdAt: item.created_at, id: item.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeMutationCursor(
  cursor: string | undefined,
): DecodedMutationCursor | null {
  if (cursor === undefined || cursor === "") {
    return null;
  }
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = CursorPayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? {
          createdAt: new Date(parsed.data.createdAt),
          id: parsed.data.id,
        }
      : null;
  } catch {
    return null;
  }
}

export function recordMutationMetric(
  entityType: MutationEntityType,
  action: MutationAction,
  audit: AuditContext,
): void {
  mutationsTotal.inc({
    entity_type: entityType,
    action,
    source: audit.source,
    actor_kind: audit.actorKind,
  });
}

export class MetricCommitStack {
  private readonly scopes: (() => void)[][] = [];

  pushScope(): void {
    this.scopes.push([]);
  }

  commitScope(): void {
    const finished = this.scopes.pop();
    if (finished === undefined) {
      return;
    }
    const parent = this.scopes.at(-1);
    if (parent === undefined) {
      for (const emit of finished) {
        emit();
      }
    } else {
      parent.push(...finished);
    }
  }

  rollbackScope(): void {
    this.scopes.pop();
  }

  enqueue(emit: () => void): void {
    const top = this.scopes.at(-1);
    if (top === undefined) {
      emit();
    } else {
      top.push(emit);
    }
  }
}
