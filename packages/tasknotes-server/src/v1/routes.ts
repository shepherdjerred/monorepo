import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { SyncRequest } from "../protocol/generated.ts";
import type { FacetStore } from "./types.ts";
import { executeSync } from "./sync.ts";

function getUserId(c: Context): string {
  const header = c.req.header("x-user-id");
  if (header !== undefined && header !== "") return header;
  const query = c.req.query("userId");
  return query !== undefined && query !== ""
    ? query
    : "00000000-0000-0000-0000-000000000000";
}

const CreateTaskBodySchema = z.object({
  id: z.string().optional(),
  project_id: z.string().optional(),
  projectId: z.string().optional(),
  section_id: z.string().optional(),
  sectionId: z.string().optional(),
  parent_id: z.string().optional(),
  parentId: z.string().optional(),
  title: z.string().default(""),
  description: z.string().optional(),
  priority: z.string().optional(),
  child_order: z.number().optional(),
  childOrder: z.number().optional(),
  due_date: z.string().optional(),
  due_datetime: z.string().optional(),
  due_timezone: z.string().optional(),
  dueTimezone: z.string().optional(),
  due_string: z.string().optional(),
  dueString: z.string().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().optional(),
  recurrenceRule: z.string().optional(),
});

const UpdateTaskBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.string().optional(),
  project_id: z.string().optional(),
  projectId: z.string().optional(),
  section_id: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  child_order: z.number().optional(),
  childOrder: z.number().optional(),
  due_date: z.string().nullable().optional(),
  due_datetime: z.string().nullable().optional(),
  due_timezone: z.string().nullable().optional(),
  dueTimezone: z.string().nullable().optional(),
  due_string: z.string().nullable().optional(),
  dueString: z.string().nullable().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
});

const CreateProjectBodySchema = z.object({
  id: z.string().optional(),
  name: z.string().default("New Project"),
  color: z.string().optional(),
  parent_id: z.string().optional(),
  parentId: z.string().optional(),
  child_order: z.number().optional(),
  childOrder: z.number().optional(),
  is_favorite: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
});

const UpdateProjectBodySchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  child_order: z.number().optional(),
  childOrder: z.number().optional(),
  is_favorite: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
});

export type V1Dependencies = {
  store: FacetStore;
};

async function handleCreateTask(
  c: Context,
  store: FacetStore,
): Promise<Response> {
  const userId = getUserId(c);
  await store.getOrCreateUser(userId);
  const rawBody: unknown = await c.req.json();
  const parsed = CreateTaskBodySchema.parse(rawBody);

  let projectId = parsed.project_id ?? parsed.projectId;
  if (projectId === undefined || projectId === "") {
    const existing = await store.listProjects({
      userId,
      includeDeleted: false,
    });
    const inbox = existing.find((p) => p.is_inbox) ?? existing[0];
    if (inbox === undefined) {
      const createdInbox = await store.createProject({
        userId,
        name: "Inbox",
        isInbox: true,
      });
      projectId = createdInbox.id;
    } else {
      projectId = inbox.id;
    }
  }

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
      (parsed.recurrence_rule !== undefined ||
        parsed.recurrenceRule !== undefined),
    recurrenceRule: parsed.recurrence_rule ?? parsed.recurrenceRule,
  });
  return c.json(created, 200);
}

function parseDueDate(
  dueDate: string | null | undefined,
): Date | null | undefined {
  if (dueDate === undefined) return undefined;
  return dueDate === null || dueDate === "" ? null : new Date(dueDate);
}

async function handleUpdateTask(
  c: Context,
  store: FacetStore,
): Promise<Response> {
  const id = c.req.param("id");
  if (id === undefined || id === "")
    return c.json({ error: "Task not found" }, 404);
  const rawBody: unknown = await c.req.json();
  const parsed = UpdateTaskBodySchema.parse(rawBody);

  const recurrenceRule = parsed.recurrence_rule ?? parsed.recurrenceRule;
  const isRecurring =
    parsed.is_recurring ??
    (recurrenceRule === undefined
      ? undefined
      : recurrenceRule !== null && recurrenceRule !== "");

  const updated = await store.updateTask(id, {
    title: parsed.title,
    description: parsed.description,
    priority: parsed.priority,
    projectId: parsed.project_id ?? parsed.projectId,
    sectionId: parsed.section_id ?? parsed.sectionId,
    parentId: parsed.parent_id ?? parsed.parentId,
    childOrder: parsed.child_order ?? parsed.childOrder,
    dueDate: parseDueDate(parsed.due_date),
    dueDatetime: parseDueDate(parsed.due_datetime),
    dueTimezone: parsed.due_timezone ?? parsed.dueTimezone,
    dueString: parsed.due_string ?? parsed.dueString,
    isRecurring,
    recurrenceRule,
    completed: parsed.completed,
    isDeleted: parsed.is_deleted,
  });

  return updated === null
    ? c.json({ error: "Task not found" }, 404)
    : c.json(updated);
}

async function handleCreateProject(
  c: Context,
  store: FacetStore,
): Promise<Response> {
  const userId = getUserId(c);
  await store.getOrCreateUser(userId);
  const rawBody: unknown = await c.req.json();
  const parsed = CreateProjectBodySchema.parse(rawBody);

  const created = await store.createProject({
    id: parsed.id,
    userId,
    name: parsed.name,
    color: parsed.color,
    parentId: parsed.parent_id ?? parsed.parentId,
    childOrder: parsed.child_order ?? parsed.childOrder,
    isFavorite: parsed.is_favorite ?? parsed.isFavorite,
  });
  return c.json(created, 200);
}

async function handleUpdateProject(
  c: Context,
  store: FacetStore,
): Promise<Response> {
  const id = c.req.param("id");
  if (id === undefined || id === "")
    return c.json({ error: "Project not found" }, 404);
  const rawBody: unknown = await c.req.json();
  const parsed = UpdateProjectBodySchema.parse(rawBody);

  const updated = await store.updateProject(id, {
    name: parsed.name,
    color: parsed.color,
    parentId: parsed.parent_id ?? parsed.parentId,
    childOrder: parsed.child_order ?? parsed.childOrder,
    isFavorite: parsed.is_favorite ?? parsed.isFavorite,
    isArchived: parsed.is_archived ?? parsed.isArchived,
    isDeleted: parsed.is_deleted,
  });

  return updated === null
    ? c.json({ error: "Project not found" }, 404)
    : c.json(updated);
}

export function v1Routes(deps: V1Dependencies): Hono {
  const app = new Hono();

  // /api/v1/sync
  app.post("/api/v1/sync", async (c) => {
    const userId = getUserId(c);
    const body = await c.req.json<SyncRequest>();
    const response = await executeSync(deps.store, userId, body);
    return c.json(response);
  });

  // /api/v1/tasks
  app.get("/api/v1/tasks", async (c) => {
    const userId = getUserId(c);
    const projectId = c.req.query("project_id");
    const tasks = await deps.store.listTasks({
      userId,
      projectId:
        projectId !== undefined && projectId !== "" ? projectId : undefined,
      includeDeleted: false,
    });
    return c.json(tasks);
  });

  app.get("/api/v1/tasks/:id", async (c) => {
    const userId = getUserId(c);
    const id = c.req.param("id");
    if (id === "") return c.json({ error: "Task not found" }, 404);
    const task = await deps.store.getTask(id, userId);
    return task === null || task.is_deleted
      ? c.json({ error: "Task not found" }, 404)
      : c.json(task);
  });

  app.post("/api/v1/tasks", (c) => handleCreateTask(c, deps.store));
  app.post("/api/v1/tasks/:id", (c) => handleUpdateTask(c, deps.store));
  app.patch("/api/v1/tasks/:id", (c) => handleUpdateTask(c, deps.store));
  app.put("/api/v1/tasks/:id", (c) => handleUpdateTask(c, deps.store));

  app.delete("/api/v1/tasks/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "") return c.json({ error: "Task not found" }, 404);
    const success = await deps.store.deleteTask(id);
    return success
      ? c.body(null, 204)
      : c.json({ error: "Task not found" }, 404);
  });

  app.post("/api/v1/tasks/:id/close", async (c) => {
    const id = c.req.param("id");
    if (id === "") return c.json({ error: "Task not found" }, 404);
    const updated = await deps.store.updateTask(id, {
      completed: true,
      completedAt: deps.store.getNow(),
    });
    return updated === null
      ? c.json({ error: "Task not found" }, 404)
      : c.body(null, 204);
  });

  app.post("/api/v1/tasks/:id/reopen", async (c) => {
    const id = c.req.param("id");
    if (id === "") return c.json({ error: "Task not found" }, 404);
    const updated = await deps.store.updateTask(id, {
      completed: false,
      completedAt: null,
    });
    return updated === null
      ? c.json({ error: "Task not found" }, 404)
      : c.body(null, 204);
  });

  // /api/v1/projects
  app.get("/api/v1/projects", async (c) => {
    const userId = getUserId(c);
    const projects = await deps.store.listProjects({
      userId,
      includeDeleted: false,
    });
    return c.json(projects);
  });

  app.get("/api/v1/projects/:id", async (c) => {
    const userId = getUserId(c);
    const id = c.req.param("id");
    if (id === "") return c.json({ error: "Project not found" }, 404);
    const project = await deps.store.getProject(id, userId);
    return project === null || project.is_deleted
      ? c.json({ error: "Project not found" }, 404)
      : c.json(project);
  });

  app.post("/api/v1/projects", (c) => handleCreateProject(c, deps.store));
  app.post("/api/v1/projects/:id", (c) => handleUpdateProject(c, deps.store));
  app.patch("/api/v1/projects/:id", (c) => handleUpdateProject(c, deps.store));
  app.put("/api/v1/projects/:id", (c) => handleUpdateProject(c, deps.store));

  app.delete("/api/v1/projects/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "") return c.json({ error: "Project not found" }, 404);
    const success = await deps.store.deleteProject(id);
    return success
      ? c.body(null, 204)
      : c.json({ error: "Project not found" }, 404);
  });

  return app;
}
