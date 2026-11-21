import { mountAttachmentRoute } from "./attachment-route.ts";
import { Hono } from "hono";
import type { Context } from "hono";
import type { z } from "zod";
import { buildTaskCompletionUpdate } from "./recurrence.ts";
import {
  CreateFilterBodySchema,
  CreateLabelBodySchema,
  CreateProjectBodySchema,
  CreateReminderBodySchema,
  CreateTaskBodySchema,
  UpdateFilterBodySchema,
  UpdateLabelBodySchema,
  UpdateProjectBodySchema,
  UpdateReminderBodySchema,
  UpdateTaskBodySchema,
} from "./rest-schemas.ts";
import { SyncRequestSchema } from "./schemas.ts";
import { parseNullableStringForUpdate } from "./sync-parsers.ts";
import { executeSync } from "./sync.ts";
import { EntityNotFoundError, type FacetStore } from "./types.ts";

function getUserId(c: Context): string {
  const header = c.req.header("x-user-id");
  if (header !== undefined && header !== "") {
    return header;
  }
  const query = c.req.query("userId");
  return query !== undefined && query !== ""
    ? query
    : "00000000-0000-0000-0000-000000000000";
}

async function readValidatedJson<T>(
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

export type V1Dependencies = {
  store: FacetStore;
};

function parseNullableDate(
  dueDate: string | null | undefined,
): Date | null | undefined {
  if (dueDate === undefined) {
    return undefined;
  }
  return dueDate === null || dueDate === "" ? null : new Date(dueDate);
}

function parseNullablePair(
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
  const createdInbox = await store.createProject({
    userId,
    name: "Inbox",
    isInbox: true,
  });
  return createdInbox.id;
}

async function handleCreateTask(
  c: Context,
  store: FacetStore,
): Promise<Response> {
  const userId = getUserId(c);
  await store.getOrCreateUser(userId);
  const body = await readValidatedJson(c, CreateTaskBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const parsed = body.data;
  const projectId = await resolveDefaultProjectId(
    store,
    userId,
    parsed.project_id ?? parsed.projectId,
  );
  const recurrenceRule = parsed.recurrence_rule ?? parsed.recurrenceRule;

  try {
    const created = await store.createTask({
      id: parsed.id,
      userId,
      projectId,
      sectionId: parsed.section_id ?? parsed.sectionId,
      parentId: parsed.parent_id ?? parsed.parentId,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      childOrder: parsed.child_order ?? parsed.childOrder,
      deadline: parseNullableDate(parsed.deadline),
      recurrenceBasis: parsed.recurrence_basis,
      dueDate:
        parsed.due_date !== undefined && parsed.due_date !== ""
          ? new Date(parsed.due_date)
          : undefined,
      dueDatetime:
        parsed.due_datetime !== undefined && parsed.due_datetime !== ""
          ? new Date(parsed.due_datetime)
          : undefined,
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
    if (error instanceof EntityNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }
}

async function handleUpdateTask(
  c: Context,
  store: FacetStore,
): Promise<Response> {
  const userId = getUserId(c);
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
    const updated = await store.updateTask(id, userId, {
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      projectId: parsed.project_id ?? parsed.projectId,
      sectionId: parseNullablePair(parsed.section_id, parsed.sectionId),
      parentId: parseNullablePair(parsed.parent_id, parsed.parentId),
      childOrder: parsed.child_order ?? parsed.childOrder,
      deadline: parseNullableDate(parsed.deadline),
      recurrenceBasis: parsed.recurrence_basis,
      dueDate: parseNullableDate(parsed.due_date),
      dueDatetime: parseNullableDate(parsed.due_datetime),
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
    if (error instanceof EntityNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }
}

type CollectionConfig<TItem, TCreate, TUpdate> = {
  basePath: string;
  entityName: string;
  createSchema: z.ZodType<TCreate>;
  updateSchema: z.ZodType<TUpdate>;
  list: (userId: string, c: Context) => Promise<TItem[]>;
  create: (userId: string, data: TCreate) => Promise<TItem>;
  update: (id: string, userId: string, data: TUpdate) => Promise<TItem | null>;
  remove: (id: string, userId: string) => Promise<boolean>;
};

function mountCollectionRoutes<TItem, TCreate, TUpdate>(
  app: Hono,
  store: FacetStore,
  cfg: CollectionConfig<TItem, TCreate, TUpdate>,
): void {
  const notFoundMsg = `${cfg.entityName} not found`;
  app.get(cfg.basePath, async (c) => c.json(await cfg.list(getUserId(c), c)));
  app.post(cfg.basePath, async (c) => {
    const userId = getUserId(c);
    await store.getOrCreateUser(userId);
    const body = await readValidatedJson(c, cfg.createSchema);
    if (!body.ok) {
      return body.response;
    }
    try {
      return c.json(await cfg.create(userId, body.data), 200);
    } catch (error: unknown) {
      if (error instanceof EntityNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });
  const handleUpdate = async (c: Context) => {
    const id = c.req.param("id");
    if (id === undefined || id === "") {
      return c.json({ error: notFoundMsg }, 404);
    }
    const body = await readValidatedJson(c, cfg.updateSchema);
    if (!body.ok) {
      return body.response;
    }
    const updated = await cfg.update(id, getUserId(c), body.data);
    return updated === null
      ? c.json({ error: notFoundMsg }, 404)
      : c.json(updated);
  };
  app.post(`${cfg.basePath}/:id`, handleUpdate);
  app.patch(`${cfg.basePath}/:id`, handleUpdate);
  app.put(`${cfg.basePath}/:id`, handleUpdate);
  app.delete(`${cfg.basePath}/:id`, async (c) => {
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: notFoundMsg }, 404);
    }
    const ok = await cfg.remove(id, getUserId(c));
    return ok ? c.body(null, 204) : c.json({ error: notFoundMsg }, 404);
  });
}

export function v1Routes(deps: V1Dependencies): Hono {
  const app = new Hono();
  mountAttachmentRoute(app, deps.store, getUserId);
  const { store } = deps;

  app.post("/api/v1/sync", async (c) => {
    const body = await readValidatedJson(c, SyncRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    const response = await executeSync(store, getUserId(c), body.data);
    return c.json(response);
  });

  app.get("/api/v1/tasks", async (c) => {
    const projectId = c.req.query("project_id");
    const tasks = await store.listTasks({
      userId: getUserId(c),
      projectId:
        projectId !== undefined && projectId !== "" ? projectId : undefined,
      includeDeleted: false,
    });
    return c.json(tasks);
  });

  app.get("/api/v1/tasks/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: "Task not found" }, 404);
    }
    const task = await store.getTask(id, getUserId(c));
    return task === null || task.is_deleted
      ? c.json({ error: "Task not found" }, 404)
      : c.json(task);
  });

  app.post("/api/v1/tasks", (c) => handleCreateTask(c, store));
  app.post("/api/v1/tasks/:id", (c) => handleUpdateTask(c, store));
  app.patch("/api/v1/tasks/:id", (c) => handleUpdateTask(c, store));
  app.put("/api/v1/tasks/:id", (c) => handleUpdateTask(c, store));

  app.delete("/api/v1/tasks/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: "Task not found" }, 404);
    }
    const ok = await store.deleteTask(id, getUserId(c));
    return ok ? c.body(null, 204) : c.json({ error: "Task not found" }, 404);
  });

  app.post("/api/v1/tasks/:id/close", async (c) => {
    const userId = getUserId(c);
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: "Task not found" }, 404);
    }
    const task = await store.getTask(id, userId);
    if (task === null || task.is_deleted) {
      return c.json({ error: "Task not found" }, 404);
    }
    const update = buildTaskCompletionUpdate(task, store.getNow());
    const updated = await store.updateTask(id, userId, update);
    return updated === null
      ? c.json({ error: "Task not found" }, 404)
      : c.body(null, 204);
  });

  app.post("/api/v1/tasks/:id/reopen", async (c) => {
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: "Task not found" }, 404);
    }
    const updated = await store.updateTask(id, getUserId(c), {
      completed: false,
      completedAt: null,
    });
    return updated === null
      ? c.json({ error: "Task not found" }, 404)
      : c.body(null, 204);
  });

  app.get("/api/v1/projects/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: "Project not found" }, 404);
    }
    const project = await store.getProject(id, getUserId(c));
    return project === null || project.is_deleted
      ? c.json({ error: "Project not found" }, 404)
      : c.json(project);
  });

  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/projects",
    entityName: "Project",
    createSchema: CreateProjectBodySchema,
    updateSchema: UpdateProjectBodySchema,
    list: (userId) => store.listProjects({ userId, includeDeleted: false }),
    create: (userId, d) =>
      store.createProject({
        id: d.id,
        userId,
        name: d.name,
        color: d.color,
        parentId: d.parent_id ?? d.parentId,
        childOrder: d.child_order ?? d.childOrder,
        isFavorite: d.is_favorite ?? d.isFavorite,
      }),
    update: (id, userId, d) =>
      store.updateProject(id, userId, {
        name: d.name,
        color: d.color,
        parentId: parseNullablePair(d.parent_id, d.parentId),
        childOrder: d.child_order ?? d.childOrder,
        isFavorite: d.is_favorite ?? d.isFavorite,
        isArchived: d.is_archived ?? d.isArchived,
        isDeleted: d.is_deleted,
      }),
    remove: (id, userId) => store.deleteProject(id, userId),
  });

  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/labels",
    entityName: "Label",
    createSchema: CreateLabelBodySchema,
    updateSchema: UpdateLabelBodySchema,
    list: (userId) => store.listLabels({ userId, includeDeleted: false }),
    create: (userId, d) =>
      store.createLabel({
        id: d.id,
        userId,
        name: d.name,
        color: d.color,
        itemOrder: d.item_order,
        isFavorite: d.is_favorite,
      }),
    update: (id, userId, d) =>
      store.updateLabel(id, userId, {
        name: d.name,
        color: d.color,
        itemOrder: d.item_order,
        isFavorite: d.is_favorite,
      }),
    remove: (id, userId) => store.deleteLabel(id, userId),
  });

  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/reminders",
    entityName: "Reminder",
    createSchema: CreateReminderBodySchema,
    updateSchema: UpdateReminderBodySchema,
    list: (userId, c) =>
      store.listReminders({
        userId,
        taskId: c.req.query("task_id"),
        includeDeleted: false,
      }),
    create: (userId, d) =>
      store.createReminder({
        id: d.id,
        userId,
        taskId: d.task_id,
        reminderType: d.reminder_type,
        minuteOffset: d.minute_offset,
        dueDatetime: parseNullableDate(d.due_datetime),
      }),
    update: (id, userId, d) =>
      store.updateReminder(id, userId, {
        reminderType: d.reminder_type,
        minuteOffset: d.minute_offset,
        dueDatetime: parseNullableDate(d.due_datetime),
        isNotified: d.is_notified,
      }),
    remove: (id, userId) => store.deleteReminder(id, userId),
  });

  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/filters",
    entityName: "Filter",
    createSchema: CreateFilterBodySchema,
    updateSchema: UpdateFilterBodySchema,
    list: (userId) => store.listFilters({ userId, includeDeleted: false }),
    create: (userId, d) =>
      store.createFilter({
        id: d.id,
        userId,
        name: d.name,
        query: d.query,
        color: d.color,
        itemOrder: d.item_order,
        isFavorite: d.is_favorite,
      }),
    update: (id, userId, d) =>
      store.updateFilter(id, userId, {
        name: d.name,
        query: d.query,
        color: d.color,
        itemOrder: d.item_order,
        isFavorite: d.is_favorite,
      }),
    remove: (id, userId) => store.deleteFilter(id, userId),
  });

  return app;
}
