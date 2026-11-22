import type { Context, Hono } from "hono";
import type { z } from "zod";
import type { Task } from "../protocol/generated.ts";
import { CommentUploadSchema } from "./comments.ts";
import { buildTaskCompletionUpdate } from "./recurrence.ts";
import {
  requireScope,
  resolveRequestActorMetadata,
  resolveRequestUserId,
  scopedStoreForRequest,
} from "./request-context.ts";
import {
  CreateTaskBodySchema,
  CreateTaskCommentBodySchema,
  RestTaskMoveBodySchema,
  RestTaskRescheduleBodySchema,
  UpdateTaskBodySchema,
} from "./rest-schemas.ts";
import {
  parseNullableDateForUpdate,
  parseNullableStringForUpdate,
  parseOptionalDateForCreate,
} from "./sync-parsers.ts";
import { moveTasks } from "./task-move.ts";
import { queryFilteredTasks, TaskListQuerySchema } from "./task-query.ts";
import { EntityNotFoundError, type FacetStore } from "./types.ts";

export type RestAuthResolution =
  | { ok: true; userId: string; store: FacetStore }
  | { ok: false; response: Response };

export function authorizeRestRequest(
  c: Context,
  store: FacetStore,
  scope: "read" | "write",
  actionHint?:
    | "complete"
    | "uncomplete"
    | "restore"
    | "move"
    | "reschedule"
    | "comment_add"
    | "comment_delete",
): RestAuthResolution {
  const scopeDenied = requireScope(c, scope);
  if (scopeDenied !== null) {
    return { ok: false, response: scopeDenied };
  }
  const resolvedUser = resolveRequestUserId(c);
  if (!resolvedUser.ok) {
    return resolvedUser;
  }
  const metaResult = resolveRequestActorMetadata(c);
  if (!metaResult.ok) {
    return metaResult;
  }
  return {
    ok: true,
    userId: resolvedUser.userId,
    store: scopedStoreForRequest(c, store, {
      source: "rest",
      actorMetadata: metaResult.metadata,
      actionHint,
    }),
  };
}

export async function readValidatedJson<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let rawJson: unknown;
  try {
    rawJson = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ error: "Invalid JSON body" }, 400),
    };
  }
  const parsed = schema.safeParse(rawJson);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export function parseNullablePair(
  primary: string | null | undefined,
  fallback: string | null | undefined,
): string | null | undefined {
  return primary === null || primary === ""
    ? null
    : parseNullableStringForUpdate(primary ?? fallback);
}

async function resolveDefaultProjectId(
  store: FacetStore,
  userId: string,
  candidate: string | undefined,
): Promise<string> {
  if (candidate !== undefined && candidate !== "") {
    return candidate;
  }
  const existing = await store.listProjects({
    userId,
    includeDeleted: false,
  });
  const inbox = existing.find((p) => p.is_inbox) ?? existing[0];
  if (inbox !== undefined) {
    return inbox.id;
  }
  const createdInbox = await store.withAuditContext(undefined).createProject({
    userId,
    name: "Inbox",
    isInbox: true,
  });
  return createdInbox.id;
}

function respondTaskMutationError(c: Context, error: unknown): Response {
  if (error instanceof EntityNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof TypeError) {
    return c.json({ error: error.message }, 400);
  }
  throw error;
}

async function handleCreateTask(
  c: Context,
  baseStore: FacetStore,
): Promise<Response> {
  const auth = authorizeRestRequest(c, baseStore, "write");
  if (!auth.ok) {
    return auth.response;
  }
  const body = await readValidatedJson(c, CreateTaskBodySchema);
  if (!body.ok) {
    return body.response;
  }
  await auth.store.getOrCreateUser(auth.userId);
  const parsed = body.data;
  const projectId = await resolveDefaultProjectId(
    auth.store,
    auth.userId,
    parsed.project_id ?? parsed.projectId,
  );
  const recurrenceRule = parsed.recurrence_rule ?? parsed.recurrenceRule;

  try {
    const created = await auth.store.createTask({
      id: parsed.id,
      userId: auth.userId,
      projectId,
      sectionId: parsed.section_id ?? parsed.sectionId,
      parentId: parsed.parent_id ?? parsed.parentId,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      childOrder: parsed.child_order ?? parsed.childOrder,
      deadline: parseNullableDateForUpdate(parsed.deadline),
      recurrenceBasis: parsed.recurrence_basis,
      dueDate: parseOptionalDateForCreate(parsed.due_date),
      dueDatetime: parseOptionalDateForCreate(parsed.due_datetime),
      dueTimezone: parsed.due_timezone ?? parsed.dueTimezone,
      dueString: parsed.due_string ?? parsed.dueString,
      isRecurring:
        parsed.is_recurring ??
        (recurrenceRule !== undefined && recurrenceRule !== ""),
      recurrenceRule,
      labelIds: parsed.label_ids ?? parsed.labelIds,
    });
    return c.json(created, 200);
  } catch (error: unknown) {
    return respondTaskMutationError(c, error);
  }
}

async function handleUpdateTask(
  c: Context,
  baseStore: FacetStore,
): Promise<Response> {
  const auth = authorizeRestRequest(c, baseStore, "write");
  if (!auth.ok) {
    return auth.response;
  }
  const id = c.req.param("id");
  if (id === undefined || id === "") {
    return c.json({ error: "Task not found" }, 404);
  }
  const body = await readValidatedJson(c, UpdateTaskBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const parsed = body.data;
  const recurrenceRule = parseNullablePair(
    parsed.recurrence_rule,
    parsed.recurrenceRule,
  );
  const hasRuleInput =
    parsed.recurrence_rule !== undefined || parsed.recurrenceRule !== undefined;
  const isRecurring =
    parsed.is_recurring ?? (hasRuleInput ? recurrenceRule !== null : undefined);

  try {
    const updated = await auth.store.updateTask(id, auth.userId, {
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      projectId: parsed.project_id ?? parsed.projectId,
      sectionId: parseNullablePair(parsed.section_id, parsed.sectionId),
      parentId: parseNullablePair(parsed.parent_id, parsed.parentId),
      childOrder: parsed.child_order ?? parsed.childOrder,
      deadline: parseNullableDateForUpdate(parsed.deadline),
      recurrenceBasis: parsed.recurrence_basis,
      dueDate: parseNullableDateForUpdate(parsed.due_date),
      dueDatetime: parseNullableDateForUpdate(parsed.due_datetime),
      dueTimezone: parseNullablePair(parsed.due_timezone, parsed.dueTimezone),
      dueString: parseNullablePair(parsed.due_string, parsed.dueString),
      isRecurring,
      recurrenceRule,
      labelIds: parsed.label_ids ?? parsed.labelIds,
      completed: parsed.completed,
      isDeleted: parsed.is_deleted,
    });
    return updated === null
      ? c.json({ error: "Task not found" }, 404)
      : c.json(updated);
  } catch (error: unknown) {
    return respondTaskMutationError(c, error);
  }
}

function mountTaskCommentRoutes(app: Hono, baseStore: FacetStore): void {
  app.get("/api/v1/tasks/:id/comments", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "read");
    if (!auth.ok) {
      return auth.response;
    }
    const task = await auth.store.getTask(c.req.param("id"), auth.userId);
    return task === null || task.is_deleted
      ? c.json({ error: "Task not found" }, 404)
      : c.json(task.comments ?? []);
  });

  app.post("/api/v1/tasks/:id/comments", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write", "comment_add");
    if (!auth.ok) {
      return auth.response;
    }
    const taskId = c.req.param("id");
    const existing = await auth.store.getTask(taskId, auth.userId);
    if (existing === null || existing.is_deleted) {
      return c.json({ error: "Task not found" }, 404);
    }
    const body = await readValidatedJson(c, CreateTaskCommentBodySchema);
    if (!body.ok) {
      return body.response;
    }
    const commentId = body.data.id ?? crypto.randomUUID();
    const createdAt = body.data.created_at ?? auth.store.getNow().toISOString();
    const validatedUpload = CommentUploadSchema.safeParse({
      comment: {
        id: commentId,
        body: body.data.body,
        created_at: createdAt,
        file_name: body.data.file_name,
      },
      attachment_base64: body.data.attachment_base64,
    });
    if (!validatedUpload.success) {
      return c.json(
        {
          error: "Invalid comment or attachment",
          details: validatedUpload.error.issues,
        },
        400,
      );
    }
    const updated = await auth.store.updateTask(taskId, auth.userId, {
      appendComment: validatedUpload.data,
    });
    const createdComment = updated?.comments?.find(
      (item) => item.id === commentId,
    );
    return c.json(createdComment ?? validatedUpload.data.comment, 201);
  });

  app.delete("/api/v1/tasks/:id/comments/:commentId", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write", "comment_delete");
    if (!auth.ok) {
      return auth.response;
    }
    const taskId = c.req.param("id");
    const commentId = c.req.param("commentId");
    const existing = await auth.store.getTask(taskId, auth.userId);
    if (existing === null || existing.is_deleted) {
      return c.json({ error: "Task not found" }, 404);
    }
    const hasComment = (existing.comments ?? []).some(
      (item) => item.id === commentId,
    );
    if (!hasComment) {
      return c.json({ error: "Comment not found" }, 404);
    }
    await auth.store.updateTask(taskId, auth.userId, {
      removeCommentId: commentId,
    });
    return c.body(null, 204);
  });
}

function mountTaskBatchAndLifecycleRoutes(
  app: Hono,
  baseStore: FacetStore,
): void {
  app.post("/api/v1/tasks/move", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write", "move");
    if (!auth.ok) {
      return auth.response;
    }
    const body = await readValidatedJson(c, RestTaskMoveBodySchema);
    if (!body.ok) {
      return body.response;
    }
    try {
      await auth.store.transaction(async (tx) => {
        await moveTasks(tx, auth.userId, body.data.tasks, {});
      });
      return c.json({ ok: true, moved: body.data.tasks.length });
    } catch (error: unknown) {
      return respondTaskMutationError(c, error);
    }
  });

  app.post("/api/v1/tasks/reschedule", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write", "reschedule");
    if (!auth.ok) {
      return auth.response;
    }
    const body = await readValidatedJson(c, RestTaskRescheduleBodySchema);
    if (!body.ok) {
      return body.response;
    }
    try {
      const items = await auth.store.transaction(async (tx) => {
        const updated: Task[] = [];
        for (const item of body.data.tasks) {
          const next = await tx.updateTask(item.id, auth.userId, {
            dueDate: parseNullableDateForUpdate(item.due_date),
            dueDatetime: parseNullableDateForUpdate(item.due_datetime),
            dueTimezone: parseNullableStringForUpdate(item.due_timezone),
            dueString: parseNullableStringForUpdate(item.due_string),
          });
          if (next === null) {
            throw new EntityNotFoundError("Task", item.id);
          }
          updated.push(next);
        }
        return updated;
      });
      return c.json({ items });
    } catch (error: unknown) {
      return respondTaskMutationError(c, error);
    }
  });

  app.post("/api/v1/tasks/:id/close", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write", "complete");
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param("id");
    const task = await auth.store.getTask(id, auth.userId);
    if (task === null || task.is_deleted) {
      return c.json({ error: "Task not found" }, 404);
    }
    const update = buildTaskCompletionUpdate(task, auth.store.getNow());
    const updated = await auth.store.updateTask(id, auth.userId, update);
    return updated === null
      ? c.json({ error: "Task not found" }, 404)
      : c.body(null, 204);
  });

  app.post("/api/v1/tasks/:id/reopen", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write", "uncomplete");
    if (!auth.ok) {
      return auth.response;
    }
    const updated = await auth.store.updateTask(
      c.req.param("id"),
      auth.userId,
      {
        completed: false,
        completedAt: null,
      },
    );
    return updated === null
      ? c.json({ error: "Task not found" }, 404)
      : c.body(null, 204);
  });

  app.post("/api/v1/tasks/:id/restore", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write", "restore");
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param("id");
    const existing = await auth.store.getTask(id, auth.userId);
    if (existing === null) {
      return c.json({ error: "Task not found" }, 404);
    }
    const restored = await auth.store.updateTask(id, auth.userId, {
      isDeleted: false,
    });
    return restored === null
      ? c.json({ error: "Task not found" }, 404)
      : c.json(restored);
  });
}

export function mountTaskRoutes(app: Hono, baseStore: FacetStore): void {
  app.get("/api/v1/tasks", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "read");
    if (!auth.ok) {
      return auth.response;
    }
    const rawQuery: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.query())) {
      if (v !== "") {
        rawQuery[k] = v;
      }
    }
    const parsedQuery = TaskListQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parsedQuery.error.issues,
        },
        400,
      );
    }
    const tasks = await queryFilteredTasks(
      auth.store,
      auth.userId,
      parsedQuery.data,
    );
    return c.json(tasks);
  });

  mountTaskBatchAndLifecycleRoutes(app, baseStore);
  mountTaskCommentRoutes(app, baseStore);

  app.get("/api/v1/tasks/:id", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "read");
    if (!auth.ok) {
      return auth.response;
    }
    const includeDeleted = c.req.query("include_deleted") === "true";
    const task = await auth.store.getTask(c.req.param("id"), auth.userId);
    return task === null || (!includeDeleted && task.is_deleted)
      ? c.json({ error: "Task not found" }, 404)
      : c.json(task);
  });

  app.post("/api/v1/tasks", (c) => handleCreateTask(c, baseStore));
  app.post("/api/v1/tasks/:id", (c) => handleUpdateTask(c, baseStore));
  app.patch("/api/v1/tasks/:id", (c) => handleUpdateTask(c, baseStore));
  app.put("/api/v1/tasks/:id", (c) => handleUpdateTask(c, baseStore));

  app.delete("/api/v1/tasks/:id", async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write");
    if (!auth.ok) {
      return auth.response;
    }
    const ok = await auth.store.deleteTask(c.req.param("id"), auth.userId);
    return ok ? c.body(null, 204) : c.json({ error: "Task not found" }, 404);
  });
}
