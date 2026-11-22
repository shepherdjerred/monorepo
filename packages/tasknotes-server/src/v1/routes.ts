import { Hono, type Context } from "hono";
import type { z } from "zod";
import { mountAttachmentRoute } from "./attachment-route.ts";
import { mountMcpRoutes } from "./mcp/mcp.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { getRequestPrincipal, requireScope } from "./request-context.ts";
import {
  CreateFilterBodySchema,
  CreateLabelBodySchema,
  CreateProjectBodySchema,
  CreateReminderBodySchema,
  CreateSectionBodySchema,
  UpdateFilterBodySchema,
  UpdateLabelBodySchema,
  UpdateProjectBodySchema,
  UpdateReminderBodySchema,
  UpdateSectionBodySchema,
} from "./rest-schemas.ts";
import { SyncRequestSchema } from "./schemas.ts";
import { parseNullableDateForUpdate } from "./sync-parsers.ts";
import { executeSync } from "./sync.ts";
import { buildWorkspaceSnapshot, TimeZoneParamSchema } from "./task-query.ts";
import {
  authorizeRestRequest,
  mountTaskRoutes,
  parseNullablePair,
  readValidatedJson,
} from "./task-routes.ts";
import { mountTokenAndAuditRoutes } from "./token-and-audit-routes.ts";
import { EntityNotFoundError, type FacetStore } from "./types.ts";

export type V1Dependencies = {
  store: FacetStore;
};

type CollectionConfig<
  TItem extends { is_deleted: boolean },
  TCreate,
  TUpdate,
> = {
  basePath: string;
  entityName: string;
  createSchema: z.ZodType<TCreate>;
  updateSchema: z.ZodType<TUpdate>;
  list: (store: FacetStore, userId: string, c: Context) => Promise<TItem[]>;
  get: (store: FacetStore, id: string, userId: string) => Promise<TItem | null>;
  create: (store: FacetStore, userId: string, data: TCreate) => Promise<TItem>;
  update: (
    store: FacetStore,
    id: string,
    userId: string,
    data: TUpdate,
  ) => Promise<TItem | null>;
  remove: (store: FacetStore, id: string, userId: string) => Promise<boolean>;
};

function mountCollectionRoutes<
  TItem extends { is_deleted: boolean },
  TCreate,
  TUpdate,
>(
  app: Hono,
  baseStore: FacetStore,
  cfg: CollectionConfig<TItem, TCreate, TUpdate>,
): void {
  const notFoundMsg = `${cfg.entityName} not found`;

  app.get(cfg.basePath, async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "read");
    return auth.ok
      ? c.json(await cfg.list(auth.store, auth.userId, c))
      : auth.response;
  });

  app.get(`${cfg.basePath}/:id`, async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "read");
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: notFoundMsg }, 404);
    }
    const item = await cfg.get(auth.store, id, auth.userId);
    return item === null || item.is_deleted
      ? c.json({ error: notFoundMsg }, 404)
      : c.json(item);
  });

  app.post(cfg.basePath, async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write");
    if (!auth.ok) {
      return auth.response;
    }
    await auth.store.getOrCreateUser(auth.userId);
    const body = await readValidatedJson(c, cfg.createSchema);
    if (!body.ok) {
      return body.response;
    }
    try {
      return c.json(await cfg.create(auth.store, auth.userId, body.data), 200);
    } catch (error: unknown) {
      if (error instanceof EntityNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof TypeError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  const handleUpdate = async (c: Context) => {
    const auth = authorizeRestRequest(c, baseStore, "write");
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param("id");
    if (id === undefined || id === "") {
      return c.json({ error: notFoundMsg }, 404);
    }
    const body = await readValidatedJson(c, cfg.updateSchema);
    if (!body.ok) {
      return body.response;
    }
    try {
      const updated = await cfg.update(auth.store, id, auth.userId, body.data);
      return updated === null
        ? c.json({ error: notFoundMsg }, 404)
        : c.json(updated);
    } catch (error: unknown) {
      if (error instanceof EntityNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof TypeError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  };

  app.post(`${cfg.basePath}/:id`, handleUpdate);
  app.patch(`${cfg.basePath}/:id`, handleUpdate);
  app.put(`${cfg.basePath}/:id`, handleUpdate);

  app.delete(`${cfg.basePath}/:id`, async (c) => {
    const auth = authorizeRestRequest(c, baseStore, "write");
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: notFoundMsg }, 404);
    }
    const ok = await cfg.remove(auth.store, id, auth.userId);
    return ok ? c.body(null, 204) : c.json({ error: notFoundMsg }, 404);
  });
}

function mountSecondaryCollections(app: Hono, store: FacetStore): void {
  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/projects",
    entityName: "Project",
    createSchema: CreateProjectBodySchema,
    updateSchema: UpdateProjectBodySchema,
    list: (s, userId) => s.listProjects({ userId, includeDeleted: false }),
    get: (s, id, userId) => s.getProject(id, userId),
    create: (s, userId, d) =>
      s.createProject({
        id: d.id,
        userId,
        name: d.name,
        color: d.color,
        parentId: d.parent_id ?? d.parentId,
        childOrder: d.child_order ?? d.childOrder,
        isFavorite: d.is_favorite ?? d.isFavorite,
      }),
    update: (s, id, userId, d) =>
      s.updateProject(id, userId, {
        name: d.name,
        color: d.color,
        parentId: parseNullablePair(d.parent_id, d.parentId),
        childOrder: d.child_order ?? d.childOrder,
        isFavorite: d.is_favorite ?? d.isFavorite,
        isArchived: d.is_archived ?? d.isArchived,
        isDeleted: d.is_deleted,
      }),
    remove: (s, id, userId) => s.deleteProject(id, userId),
  });

  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/sections",
    entityName: "Section",
    createSchema: CreateSectionBodySchema,
    updateSchema: UpdateSectionBodySchema,
    list: (s, userId, c) =>
      s.listSections({
        userId,
        projectId: c.req.query("project_id"),
        includeDeleted: false,
      }),
    get: (s, id, userId) => s.getSection(id, userId),
    create: (s, userId, d) =>
      s.createSection({
        id: d.id,
        userId,
        projectId: d.project_id ?? d.projectId ?? "",
        name: d.name,
        sectionOrder: d.section_order ?? d.sectionOrder,
      }),
    update: (s, id, userId, d) =>
      s.updateSection(id, userId, {
        name: d.name,
        sectionOrder: d.section_order ?? d.sectionOrder,
        isArchived: d.is_archived ?? d.isArchived,
        isDeleted: d.is_deleted,
      }),
    remove: (s, id, userId) => s.deleteSection(id, userId),
  });

  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/labels",
    entityName: "Label",
    createSchema: CreateLabelBodySchema,
    updateSchema: UpdateLabelBodySchema,
    list: (s, userId) => s.listLabels({ userId, includeDeleted: false }),
    get: (s, id, userId) => s.getLabel(id, userId),
    create: (s, userId, d) =>
      s.createLabel({
        id: d.id,
        userId,
        name: d.name,
        color: d.color,
        itemOrder: d.item_order,
        isFavorite: d.is_favorite,
      }),
    update: (s, id, userId, d) =>
      s.updateLabel(id, userId, {
        name: d.name,
        color: d.color,
        itemOrder: d.item_order,
        isFavorite: d.is_favorite,
        isDeleted: d.is_deleted,
      }),
    remove: (s, id, userId) => s.deleteLabel(id, userId),
  });

  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/reminders",
    entityName: "Reminder",
    createSchema: CreateReminderBodySchema,
    updateSchema: UpdateReminderBodySchema,
    list: (s, userId, c) =>
      s.listReminders({
        userId,
        taskId: c.req.query("task_id"),
        includeDeleted: false,
      }),
    get: (s, id, userId) => s.getReminder(id, userId),
    create: (s, userId, d) =>
      s.createReminder({
        id: d.id,
        userId,
        taskId: d.task_id,
        reminderType: d.reminder_type,
        minuteOffset: d.minute_offset,
        dueDatetime: parseNullableDateForUpdate(d.due_datetime),
      }),
    update: (s, id, userId, d) =>
      s.updateReminder(id, userId, {
        reminderType: d.reminder_type,
        minuteOffset: d.minute_offset,
        dueDatetime: parseNullableDateForUpdate(d.due_datetime),
        isNotified: d.is_notified,
        isDeleted: d.is_deleted,
      }),
    remove: (s, id, userId) => s.deleteReminder(id, userId),
  });

  mountCollectionRoutes(app, store, {
    basePath: "/api/v1/filters",
    entityName: "Filter",
    createSchema: CreateFilterBodySchema,
    updateSchema: UpdateFilterBodySchema,
    list: (s, userId) => s.listFilters({ userId, includeDeleted: false }),
    get: (s, id, userId) => s.getFilter(id, userId),
    create: (s, userId, d) =>
      s.createFilter({
        id: d.id,
        userId,
        name: d.name,
        query: d.query,
        color: d.color,
        itemOrder: d.item_order,
        isFavorite: d.is_favorite,
      }),
    update: (s, id, userId, d) =>
      s.updateFilter(id, userId, {
        name: d.name,
        query: d.query,
        color: d.color,
        itemOrder: d.item_order,
        isFavorite: d.is_favorite,
        isDeleted: d.is_deleted,
      }),
    remove: (s, id, userId) => s.deleteFilter(id, userId),
  });
}

export function v1Routes(deps: V1Dependencies): Hono {
  const app = new Hono();
  const { store } = deps;

  mountAttachmentRoute(app, store);
  mountTokenAndAuditRoutes(app, store);
  mountMcpRoutes(app, store);

  app.get("/api/v1/openapi.json", (c) => {
    const scopeDenied = requireScope(c, "read");
    if (scopeDenied !== null) {
      return scopeDenied;
    }
    const origin = new URL(c.req.url).origin;
    return c.json(buildOpenApiDocument(origin));
  });

  app.get("/api/v1/workspace", async (c) => {
    const auth = authorizeRestRequest(c, store, "read");
    if (!auth.ok) {
      return auth.response;
    }
    const rawTz = c.req.query("tz");
    let tz = "UTC";
    if (rawTz !== undefined && rawTz !== "") {
      const parsedTz = TimeZoneParamSchema.safeParse(rawTz);
      if (!parsedTz.success) {
        return c.json({ error: "Invalid IANA timezone" }, 400);
      }
      tz = parsedTz.data;
    }
    return c.json(
      await buildWorkspaceSnapshot(
        auth.store,
        auth.userId,
        getRequestPrincipal(c),
        tz,
      ),
    );
  });

  app.post("/api/v1/sync", async (c) => {
    const body = await readValidatedJson(c, SyncRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    const hasWrites = body.data.commands.length > 0;
    const auth = authorizeRestRequest(c, store, hasWrites ? "write" : "read");
    if (!auth.ok) {
      return auth.response;
    }
    const baseAudit = auth.store.getAuditContext();
    const syncStore = auth.store.withAuditContext(
      baseAudit === undefined ? undefined : { ...baseAudit, source: "sync" },
    );
    const response = await executeSync(syncStore, auth.userId, body.data);
    return c.json(response);
  });

  mountTaskRoutes(app, store);
  mountSecondaryCollections(app, store);

  return app;
}
