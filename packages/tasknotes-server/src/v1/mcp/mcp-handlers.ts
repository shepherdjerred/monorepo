import { z } from "zod";
import {
  ActorKindSchema,
  type MutationAction,
  MutationActionSchema,
  MutationEntityTypeSchema,
  MutationSourceSchema,
} from "../auth-types.ts";
import { CommentUploadSchema } from "../comments.ts";
import { executeMcpOrgTool, type McpExecCtx } from "./mcp-org-handlers.ts";
import { buildTaskCompletionUpdate } from "../recurrence.ts";
import {
  CreateTaskBodySchema,
  RestTaskMoveBodySchema,
  RestTaskRescheduleBodySchema,
  UpdateTaskBodySchema,
} from "../rest-schemas.ts";
import {
  parseNullableDateForUpdate,
  parseNullableStringForUpdate,
  parseOptionalDateForCreate,
} from "../sync-parsers.ts";
import { moveTasks } from "../task-move.ts";
import {
  buildWorkspaceSnapshot,
  queryFilteredTasks,
  TaskListQuerySchema,
  TimeZoneParamSchema,
} from "../task-query.ts";
import { EntityNotFoundError, type FacetStore } from "../types.ts";

const IdArgSchema = z.object({
  id: z.string().min(1),
  include_deleted: z.boolean().optional(),
});

const AddCommentToolSchema = z.object({
  task_id: z.string().min(1),
  body: z.string().trim().min(1).max(32_000),
});

const DeleteCommentToolSchema = z.object({
  task_id: z.string().min(1),
  comment_id: z.uuid(),
});

const ListMutationsToolSchema = z.object({
  token_id: z.string().min(1).optional(),
  actor_kind: ActorKindSchema.optional(),
  entity_type: MutationEntityTypeSchema.optional(),
  entity_id: z.string().min(1).optional(),
  action: MutationActionSchema.optional(),
  source: MutationSourceSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

function withHint(store: FacetStore, actionHint: MutationAction): FacetStore {
  const base = store.getAuditContext();
  return base === undefined
    ? store
    : store.withAuditContext({ ...base, actionHint });
}

async function resolveDefaultProject(
  store: FacetStore,
  userId: string,
  candidate?: string,
): Promise<string> {
  if (candidate !== undefined && candidate !== "") {
    return candidate;
  }
  await store.getOrCreateUser(userId);
  const projects = await store.listProjects({ userId, includeDeleted: false });
  const inbox = projects.find((p) => p.is_inbox) ?? projects[0];
  if (inbox !== undefined) {
    return inbox.id;
  }
  const created = await store.withAuditContext(undefined).createProject({
    userId,
    name: "Inbox",
    isInbox: true,
  });
  return created.id;
}

async function runCreateTask(
  ctx: McpExecCtx,
  args: Record<string, unknown>,
): Promise<unknown> {
  const d = CreateTaskBodySchema.parse(args);
  const projectId = await resolveDefaultProject(
    ctx.store,
    ctx.userId,
    d.project_id ?? d.projectId,
  );
  const rule = d.recurrence_rule ?? d.recurrenceRule;
  return await ctx.store.createTask({
    id: d.id,
    userId: ctx.userId,
    projectId,
    sectionId: d.section_id ?? d.sectionId,
    parentId: d.parent_id ?? d.parentId,
    title: d.title,
    description: d.description,
    priority: d.priority,
    childOrder: d.child_order ?? d.childOrder,
    deadline: parseNullableDateForUpdate(d.deadline),
    recurrenceBasis: d.recurrence_basis,
    dueDate: parseOptionalDateForCreate(d.due_date),
    dueDatetime: parseOptionalDateForCreate(d.due_datetime),
    dueTimezone: d.due_timezone ?? d.dueTimezone,
    dueString: d.due_string ?? d.dueString,
    isRecurring: d.is_recurring ?? (rule !== undefined && rule !== ""),
    recurrenceRule: rule,
    labelIds: d.label_ids ?? d.labelIds,
  });
}

async function runUpdateTask(
  ctx: McpExecCtx,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { id } = IdArgSchema.parse(args);
  const d = UpdateTaskBodySchema.parse(args);
  const ruleInput = d.recurrence_rule ?? d.recurrenceRule;
  const rule = parseNullableStringForUpdate(ruleInput);
  const hasRule =
    d.recurrence_rule !== undefined || d.recurrenceRule !== undefined;
  const updated = await ctx.store.updateTask(id, ctx.userId, {
    title: d.title,
    description: d.description,
    priority: d.priority,
    projectId: d.project_id ?? d.projectId,
    sectionId: parseNullableStringForUpdate(d.section_id ?? d.sectionId),
    parentId: parseNullableStringForUpdate(d.parent_id ?? d.parentId),
    childOrder: d.child_order ?? d.childOrder,
    deadline: parseNullableDateForUpdate(d.deadline),
    recurrenceBasis: d.recurrence_basis,
    dueDate: parseNullableDateForUpdate(d.due_date),
    dueDatetime: parseNullableDateForUpdate(d.due_datetime),
    dueTimezone: parseNullableStringForUpdate(d.due_timezone ?? d.dueTimezone),
    dueString: parseNullableStringForUpdate(d.due_string ?? d.dueString),
    isRecurring: d.is_recurring ?? (hasRule ? rule !== null : undefined),
    recurrenceRule: rule,
    labelIds: d.label_ids ?? d.labelIds,
  });
  if (updated === null) {
    throw new EntityNotFoundError("Task", id);
  }
  return updated;
}

async function runListTasks(
  ctx: McpExecCtx,
  args: Record<string, unknown>,
): Promise<unknown> {
  const normalized: Record<string, unknown> = { ...args };
  for (const flag of ["completed", "include_deleted", "overdue"]) {
    if (typeof normalized[flag] === "boolean") {
      normalized[flag] = String(normalized[flag]);
    }
  }
  const query = TaskListQuerySchema.parse(normalized);
  return await queryFilteredTasks(ctx.store, ctx.userId, query);
}

const MCP_TOOL_RUNNERS: Record<
  string,
  (ctx: McpExecCtx, args: Record<string, unknown>) => Promise<unknown>
> = {
  facet_get_workspace: async (ctx, args) => {
    const tz =
      args["tz"] === undefined ? "UTC" : TimeZoneParamSchema.parse(args["tz"]);
    return await buildWorkspaceSnapshot(
      ctx.store,
      ctx.userId,
      ctx.principal,
      tz,
    );
  },
  facet_list_tasks: runListTasks,
  facet_get_task: async (ctx, args) => {
    const parsed = IdArgSchema.parse(args);
    const task = await ctx.store.getTask(parsed.id, ctx.userId);
    if (task === null || (parsed.include_deleted !== true && task.is_deleted)) {
      throw new EntityNotFoundError("Task", parsed.id);
    }
    return task;
  },
  facet_list_mutations: async (ctx, args) => {
    const q = ListMutationsToolSchema.parse(args);
    return await ctx.store.listMutations({
      userId: ctx.userId,
      tokenId: q.token_id,
      actorKind: q.actor_kind,
      entityType: q.entity_type,
      entityId: q.entity_id,
      action: q.action,
      source: q.source,
      limit: q.limit,
      cursor: q.cursor,
    });
  },
  facet_create_task: runCreateTask,
  facet_update_task: runUpdateTask,
  facet_complete_task: async (ctx, args) => {
    const { id } = IdArgSchema.parse(args);
    const existing = await ctx.store.getTask(id, ctx.userId);
    if (existing === null || existing.is_deleted) {
      throw new EntityNotFoundError("Task", id);
    }
    const update = buildTaskCompletionUpdate(existing, ctx.store.getNow());
    const updated = await withHint(ctx.store, "complete").updateTask(
      id,
      ctx.userId,
      update,
    );
    if (updated === null) {
      throw new EntityNotFoundError("Task", id);
    }
    return updated;
  },
  facet_reopen_task: async (ctx, args) => {
    const { id } = IdArgSchema.parse(args);
    const updated = await withHint(ctx.store, "uncomplete").updateTask(
      id,
      ctx.userId,
      { completed: false, completedAt: null },
    );
    if (updated === null) {
      throw new EntityNotFoundError("Task", id);
    }
    return updated;
  },
  facet_delete_task: async (ctx, args) => {
    const { id } = IdArgSchema.parse(args);
    const ok = await ctx.store.deleteTask(id, ctx.userId);
    if (!ok) {
      throw new EntityNotFoundError("Task", id);
    }
    return { deleted: true, id };
  },
  facet_restore_task: async (ctx, args) => {
    const { id } = IdArgSchema.parse(args);
    const updated = await withHint(ctx.store, "restore").updateTask(
      id,
      ctx.userId,
      { isDeleted: false },
    );
    if (updated === null) {
      throw new EntityNotFoundError("Task", id);
    }
    return updated;
  },
  facet_move_tasks: async (ctx, args) => {
    const parsed = RestTaskMoveBodySchema.parse(args);
    await withHint(ctx.store, "move").transaction(async (tx) => {
      await moveTasks(tx, ctx.userId, parsed.tasks, {});
    });
    return { ok: true, moved: parsed.tasks.length };
  },
  facet_reschedule_tasks: async (ctx, args) => {
    const parsed = RestTaskRescheduleBodySchema.parse(args);
    return await withHint(ctx.store, "reschedule").transaction(async (tx) => {
      const items = [];
      for (const item of parsed.tasks) {
        const next = await tx.updateTask(item.id, ctx.userId, {
          dueDate: parseNullableDateForUpdate(item.due_date),
          dueDatetime: parseNullableDateForUpdate(item.due_datetime),
          dueTimezone: parseNullableStringForUpdate(item.due_timezone),
          dueString: parseNullableStringForUpdate(item.due_string),
        });
        if (next === null) {
          throw new EntityNotFoundError("Task", item.id);
        }
        items.push(next);
      }
      return { items };
    });
  },
  facet_add_comment: async (ctx, args) => {
    const d = AddCommentToolSchema.parse(args);
    const existing = await ctx.store.getTask(d.task_id, ctx.userId);
    if (existing === null || existing.is_deleted) {
      throw new EntityNotFoundError("Task", d.task_id);
    }
    const commentId = crypto.randomUUID();
    const upload = CommentUploadSchema.parse({
      comment: {
        id: commentId,
        body: d.body,
        created_at: ctx.store.getNow().toISOString(),
      },
    });
    const updated = await ctx.store.updateTask(d.task_id, ctx.userId, {
      appendComment: upload,
    });
    return updated?.comments?.find((c) => c.id === commentId) ?? upload.comment;
  },
  facet_delete_comment: async (ctx, args) => {
    const d = DeleteCommentToolSchema.parse(args);
    const existing = await ctx.store.getTask(d.task_id, ctx.userId);
    if (existing === null || existing.is_deleted) {
      throw new EntityNotFoundError("Task", d.task_id);
    }
    if (!(existing.comments ?? []).some((c) => c.id === d.comment_id)) {
      throw new EntityNotFoundError("Comment", d.comment_id);
    }
    await ctx.store.updateTask(d.task_id, ctx.userId, {
      removeCommentId: d.comment_id,
    });
    return { deleted: true, comment_id: d.comment_id };
  },
  facet_manage_organization: executeMcpOrgTool,
};

export async function dispatchMcpTool(
  ctx: McpExecCtx,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const runner = MCP_TOOL_RUNNERS[toolName];
  if (runner === undefined) {
    throw new Error(`Unknown MCP tool: ${toolName}`);
  }
  return await runner(ctx, args);
}
