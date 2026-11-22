import { z } from "zod";
import type { AuthPrincipal } from "../auth-types.ts";
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
} from "../rest-schemas.ts";
import { parseNullableDateForUpdate } from "../sync-parsers.ts";
import { parseNullablePair } from "../task-routes.ts";
import { EntityNotFoundError, type FacetStore } from "../types.ts";

export type McpExecCtx = {
  store: FacetStore;
  userId: string;
  principal: AuthPrincipal;
};

const ManageOrgToolSchema = z.object({
  entity_type: z.enum(["project", "section", "label", "reminder", "filter"]),
  operation: z.enum(["create", "update", "delete"]),
  id: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

type OrgEntityType = z.infer<typeof ManageOrgToolSchema>["entity_type"];

async function executeOrgDelete(
  ctx: McpExecCtx,
  entityType: OrgEntityType,
  id: string,
): Promise<{ deleted: true; id: string }> {
  const handlers: Record<OrgEntityType, () => Promise<boolean>> = {
    project: () => ctx.store.deleteProject(id, ctx.userId),
    section: () => ctx.store.deleteSection(id, ctx.userId),
    label: () => ctx.store.deleteLabel(id, ctx.userId),
    reminder: () => ctx.store.deleteReminder(id, ctx.userId),
    filter: () => ctx.store.deleteFilter(id, ctx.userId),
  };
  const ok = await handlers[entityType]();
  if (!ok) {
    throw new EntityNotFoundError(entityType, id);
  }
  return { deleted: true, id };
}

const ORG_CREATORS: Record<
  OrgEntityType,
  (ctx: McpExecCtx, raw: Record<string, unknown>) => Promise<unknown>
> = {
  project: async (ctx, raw) => {
    const d = CreateProjectBodySchema.parse(raw);
    return await ctx.store.createProject({
      id: d.id,
      userId: ctx.userId,
      name: d.name,
      color: d.color,
      parentId: d.parent_id ?? d.parentId,
      childOrder: d.child_order ?? d.childOrder,
      isFavorite: d.is_favorite ?? d.isFavorite,
    });
  },
  section: async (ctx, raw) => {
    const d = CreateSectionBodySchema.parse(raw);
    return await ctx.store.createSection({
      id: d.id,
      userId: ctx.userId,
      projectId: d.project_id ?? d.projectId ?? "",
      name: d.name,
      sectionOrder: d.section_order ?? d.sectionOrder,
    });
  },
  label: async (ctx, raw) => {
    const d = CreateLabelBodySchema.parse(raw);
    return await ctx.store.createLabel({
      id: d.id,
      userId: ctx.userId,
      name: d.name,
      color: d.color,
      itemOrder: d.item_order,
      isFavorite: d.is_favorite,
    });
  },
  reminder: async (ctx, raw) => {
    const d = CreateReminderBodySchema.parse(raw);
    return await ctx.store.createReminder({
      id: d.id,
      userId: ctx.userId,
      taskId: d.task_id,
      reminderType: d.reminder_type,
      minuteOffset: d.minute_offset,
      dueDatetime: parseNullableDateForUpdate(d.due_datetime),
    });
  },
  filter: async (ctx, raw) => {
    const d = CreateFilterBodySchema.parse(raw);
    return await ctx.store.createFilter({
      id: d.id,
      userId: ctx.userId,
      name: d.name,
      query: d.query,
      color: d.color,
      itemOrder: d.item_order,
      isFavorite: d.is_favorite,
    });
  },
};

const ORG_UPDATERS: Record<
  OrgEntityType,
  (
    ctx: McpExecCtx,
    id: string,
    raw: Record<string, unknown>,
  ) => Promise<unknown>
> = {
  project: async (ctx, id, raw) => {
    const d = UpdateProjectBodySchema.parse(raw);
    const updated = await ctx.store.updateProject(id, ctx.userId, {
      name: d.name,
      color: d.color,
      parentId: parseNullablePair(d.parent_id, d.parentId),
      childOrder: d.child_order ?? d.childOrder,
      isFavorite: d.is_favorite ?? d.isFavorite,
      isArchived: d.is_archived ?? d.isArchived,
      isDeleted: d.is_deleted,
    });
    if (updated === null) {
      throw new EntityNotFoundError("Project", id);
    }
    return updated;
  },
  section: async (ctx, id, raw) => {
    const d = UpdateSectionBodySchema.parse(raw);
    const updated = await ctx.store.updateSection(id, ctx.userId, {
      name: d.name,
      sectionOrder: d.section_order ?? d.sectionOrder,
      isArchived: d.is_archived ?? d.isArchived,
      isDeleted: d.is_deleted,
    });
    if (updated === null) {
      throw new EntityNotFoundError("Section", id);
    }
    return updated;
  },
  label: async (ctx, id, raw) => {
    const d = UpdateLabelBodySchema.parse(raw);
    const updated = await ctx.store.updateLabel(id, ctx.userId, {
      name: d.name,
      color: d.color,
      itemOrder: d.item_order,
      isFavorite: d.is_favorite,
      isDeleted: d.is_deleted,
    });
    if (updated === null) {
      throw new EntityNotFoundError("Label", id);
    }
    return updated;
  },
  reminder: async (ctx, id, raw) => {
    const d = UpdateReminderBodySchema.parse(raw);
    const updated = await ctx.store.updateReminder(id, ctx.userId, {
      reminderType: d.reminder_type,
      minuteOffset: d.minute_offset,
      dueDatetime: parseNullableDateForUpdate(d.due_datetime),
      isNotified: d.is_notified,
      isDeleted: d.is_deleted,
    });
    if (updated === null) {
      throw new EntityNotFoundError("Reminder", id);
    }
    return updated;
  },
  filter: async (ctx, id, raw) => {
    const d = UpdateFilterBodySchema.parse(raw);
    const updated = await ctx.store.updateFilter(id, ctx.userId, {
      name: d.name,
      query: d.query,
      color: d.color,
      itemOrder: d.item_order,
      isFavorite: d.is_favorite,
      isDeleted: d.is_deleted,
    });
    if (updated === null) {
      throw new EntityNotFoundError("Filter", id);
    }
    return updated;
  },
};

export async function executeMcpOrgTool(
  ctx: McpExecCtx,
  rawArgs: Record<string, unknown>,
): Promise<unknown> {
  const args = ManageOrgToolSchema.parse(rawArgs);
  await ctx.store.getOrCreateUser(ctx.userId);

  if (args.operation === "create") {
    return await ORG_CREATORS[args.entity_type](ctx, args.data);
  }
  if (args.id === undefined) {
    throw new TypeError(`id is required for ${args.operation}`);
  }
  return args.operation === "delete"
    ? await executeOrgDelete(ctx, args.entity_type, args.id)
    : await ORG_UPDATERS[args.entity_type](ctx, args.id, args.data);
}
