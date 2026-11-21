import type { z } from "zod";
import { buildTaskCompletionUpdate } from "./recurrence.ts";
import type {
  FilterAddArgsSchema,
  LabelAddArgsSchema,
  ProjectAddArgsSchema,
  ProjectUpdateArgsSchema,
  ReminderAddArgsSchema,
  ReminderUpdateArgsSchema,
  SectionAddArgsSchema,
  TaskAddArgsSchema,
  TaskCompleteArgsSchema,
  TaskUpdateArgsSchema,
  ValidatedSyncCommand,
} from "./schemas.ts";
import {
  parseNullableDateForUpdate,
  parseNullableStringForUpdate,
  parseOptionalDateForCreate,
  parseOptionalStringForCreate,
  parseValidDate,
  resolveLabelIds,
  resolveNullableIdForUpdate,
  resolveOptionalIdForCreate,
  resolveRequiredId,
} from "./sync-parsers.ts";
import { moveTasks } from "./task-move.ts";
import { EntityNotFoundError, type FacetStore } from "./types.ts";

export type CommandContext = {
  queuedTempId?: string | undefined;
  tempIdMapping: Record<string, string>;
};

export type CommandOutcome = {
  createdId?: string | undefined;
  tempId?: string | undefined;
};

async function resolveTaskProjectId(
  tx: FacetStore,
  userId: string,
  rawProjectId: string,
  tempIdMapping: Record<string, string>,
): Promise<string> {
  const resolvedProjectId = resolveRequiredId(rawProjectId, tempIdMapping);
  if (resolvedProjectId !== "") {
    return resolvedProjectId;
  }
  const existingProjects = await tx.listProjects({
    userId,
    includeDeleted: false,
  });
  const inbox = existingProjects.find((p) => p.is_inbox) ?? existingProjects[0];
  if (inbox !== undefined) {
    return inbox.id;
  }
  const newInbox = await tx.createProject({
    userId,
    name: "Inbox",
    isInbox: true,
  });
  return newInbox.id;
}

function assertMutated(
  ok: boolean,
  entityName: string,
  entityId: string,
): void {
  if (!ok) {
    throw new EntityNotFoundError(entityName, entityId);
  }
}

async function handleTaskAdd(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof TaskAddArgsSchema>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const finalProjectId = await resolveTaskProjectId(
    tx,
    userId,
    args.project_id,
    ctx.tempIdMapping,
  );
  const recurrenceRule = parseOptionalStringForCreate(args.recurrence_rule);
  const created = await tx.createTask({
    id: args.id,
    userId,
    projectId: finalProjectId,
    sectionId: resolveOptionalIdForCreate(args.section_id, ctx.tempIdMapping),
    parentId: resolveOptionalIdForCreate(args.parent_id, ctx.tempIdMapping),
    title: args.title,
    description: args.description,
    priority: args.priority,
    childOrder: args.child_order,
    deadline: parseOptionalDateForCreate(args.deadline),
    recurrenceBasis: args.recurrence_basis,
    dueDate: parseOptionalDateForCreate(args.due_date),
    dueDatetime: parseOptionalDateForCreate(args.due_datetime),
    dueTimezone: parseOptionalStringForCreate(args.due_timezone),
    dueString: parseOptionalStringForCreate(args.due_string),
    isRecurring: recurrenceRule !== undefined,
    recurrenceRule,
    labelIds: resolveLabelIds(args.label_ids, ctx.tempIdMapping) ?? [],
  });
  return {
    createdId: created.id,
    tempId: ctx.queuedTempId ?? args.temp_id,
  };
}

async function handleTaskUpdate(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof TaskUpdateArgsSchema>,
  tempIdMapping: Record<string, string>,
): Promise<CommandOutcome> {
  const resolvedId = resolveRequiredId(args.id, tempIdMapping);
  const resolvedProjectId =
    args.project_id !== undefined && args.project_id !== ""
      ? resolveRequiredId(args.project_id, tempIdMapping)
      : undefined;
  const recurrenceRule = parseNullableStringForUpdate(args.recurrence_rule);
  const isRecurring =
    args.recurrence_rule === undefined ? undefined : recurrenceRule !== null;

  const updated = await tx.updateTask(resolvedId, userId, {
    appendComment: args.append_comment,
    removeCommentId: args.remove_comment_id,
    removeAttachmentId: args.remove_attachment_id,
    isDeleted: args.restore_deleted === true ? false : undefined,
    title: args.title,
    description: args.description,
    priority: args.priority,
    projectId: resolvedProjectId,
    sectionId: resolveNullableIdForUpdate(args.section_id, tempIdMapping),
    parentId: resolveNullableIdForUpdate(args.parent_id, tempIdMapping),
    childOrder: args.child_order,
    deadline: parseNullableDateForUpdate(args.deadline),
    recurrenceBasis: args.recurrence_basis,
    dueDate: parseNullableDateForUpdate(args.due_date),
    dueDatetime: parseNullableDateForUpdate(args.due_datetime),
    dueTimezone: parseNullableStringForUpdate(args.due_timezone),
    dueString: parseNullableStringForUpdate(args.due_string),
    isRecurring,
    recurrenceRule,
    labelIds: resolveLabelIds(args.label_ids, tempIdMapping),
  });
  assertMutated(updated !== null, "Task", resolvedId);
  return {};
}

async function handleTaskComplete(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof TaskCompleteArgsSchema>,
  tempIdMapping: Record<string, string>,
): Promise<CommandOutcome> {
  const resolvedId = resolveRequiredId(args.id, tempIdMapping);
  const existing = await tx.getTask(resolvedId, userId);
  if (existing === null || existing.is_deleted) {
    throw new EntityNotFoundError("Task", resolvedId);
  }
  const completedAt =
    args.completed_at !== undefined &&
    args.completed_at !== null &&
    args.completed_at !== ""
      ? parseValidDate(args.completed_at)
      : tx.getNow();
  const update = buildTaskCompletionUpdate(existing, completedAt);
  const updated = await tx.updateTask(resolvedId, userId, update);
  assertMutated(updated !== null, "Task", resolvedId);
  return {};
}

async function handleProjectAdd(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof ProjectAddArgsSchema>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const created = await tx.createProject({
    id: args.id,
    userId,
    name: args.name,
    color: args.color,
    parentId: resolveOptionalIdForCreate(args.parent_id, ctx.tempIdMapping),
    childOrder: args.child_order,
    isFavorite: args.is_favorite,
  });
  return {
    createdId: created.id,
    tempId: ctx.queuedTempId ?? args.temp_id,
  };
}

async function handleProjectUpdate(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof ProjectUpdateArgsSchema>,
  tempIdMapping: Record<string, string>,
): Promise<CommandOutcome> {
  const resolvedId = resolveRequiredId(args.id, tempIdMapping);
  const updated = await tx.updateProject(resolvedId, userId, {
    name: args.name,
    color: args.color,
    parentId: resolveNullableIdForUpdate(args.parent_id, tempIdMapping),
    childOrder: args.child_order,
    isFavorite: args.is_favorite,
    isArchived: args.is_archived,
  });
  assertMutated(updated !== null, "Project", resolvedId);
  return {};
}

async function handleSectionAdd(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof SectionAddArgsSchema>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const created = await tx.createSection({
    id: args.id,
    userId,
    projectId: resolveRequiredId(args.project_id, ctx.tempIdMapping),
    name: args.name,
    sectionOrder: args.section_order,
  });
  return {
    createdId: created.id,
    tempId: ctx.queuedTempId ?? args.temp_id,
  };
}

async function handleLabelAdd(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof LabelAddArgsSchema>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const created = await tx.createLabel({
    id: args.id,
    userId,
    name: args.name,
    color: args.color,
    itemOrder: args.item_order,
    isFavorite: args.is_favorite,
  });
  return {
    createdId: created.id,
    tempId: ctx.queuedTempId ?? args.temp_id,
  };
}

async function handleReminderAdd(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof ReminderAddArgsSchema>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const created = await tx.createReminder({
    id: args.id,
    userId,
    taskId: resolveRequiredId(args.task_id, ctx.tempIdMapping),
    reminderType: args.reminder_type,
    minuteOffset: args.minute_offset,
    dueDatetime: parseOptionalDateForCreate(args.due_datetime),
  });
  return {
    createdId: created.id,
    tempId: ctx.queuedTempId ?? args.temp_id,
  };
}

async function handleReminderUpdate(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof ReminderUpdateArgsSchema>,
  tempIdMapping: Record<string, string>,
): Promise<CommandOutcome> {
  const resolvedId = resolveRequiredId(args.id, tempIdMapping);
  const updated = await tx.updateReminder(resolvedId, userId, {
    reminderType: args.reminder_type,
    minuteOffset: args.minute_offset,
    dueDatetime: parseNullableDateForUpdate(args.due_datetime),
    isNotified: args.is_notified,
  });
  assertMutated(updated !== null, "Reminder", resolvedId);
  return {};
}

async function handleFilterAdd(
  tx: FacetStore,
  userId: string,
  args: z.infer<typeof FilterAddArgsSchema>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const created = await tx.createFilter({
    id: args.id,
    userId,
    name: args.name,
    query: args.query,
    color: args.color,
    itemOrder: args.item_order,
    isFavorite: args.is_favorite,
  });
  return {
    createdId: created.id,
    tempId: ctx.queuedTempId ?? args.temp_id,
  };
}

type HandlerFn = (
  tx: FacetStore,
  userId: string,
  cmd: ValidatedSyncCommand,
  ctx: CommandContext,
) => Promise<CommandOutcome>;

export const commandHandlers: Record<ValidatedSyncCommand["type"], HandlerFn> =
  {
    TaskAdd: async (tx, userId, cmd, ctx) =>
      cmd.type === "TaskAdd"
        ? await handleTaskAdd(tx, userId, cmd.args, ctx)
        : {},
    TaskUpdate: async (tx, userId, cmd, ctx) =>
      cmd.type === "TaskUpdate"
        ? await handleTaskUpdate(tx, userId, cmd.args, ctx.tempIdMapping)
        : {},
    TaskDelete: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "TaskDelete") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        assertMutated(await tx.deleteTask(id, userId), "Task", id);
      }
      return {};
    },
    TaskMove: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "TaskMove") {
        await moveTasks(tx, userId, cmd.args.tasks, ctx.tempIdMapping);
      }
      return {};
    },
    TaskReschedule: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "TaskReschedule") {
        for (const task of cmd.args.tasks) {
          await handleTaskUpdate(tx, userId, task, ctx.tempIdMapping);
        }
      }
      return {};
    },
    TaskComplete: async (tx, userId, cmd, ctx) =>
      cmd.type === "TaskComplete"
        ? await handleTaskComplete(tx, userId, cmd.args, ctx.tempIdMapping)
        : {},
    TaskUncomplete: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "TaskUncomplete") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        const res = await tx.updateTask(id, userId, {
          completed: false,
          completedAt: null,
        });
        assertMutated(res !== null, "Task", id);
      }
      return {};
    },
    TaskReorder: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "TaskReorder") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        const res = await tx.updateTask(id, userId, {
          childOrder: cmd.args.child_order,
        });
        assertMutated(res !== null, "Task", id);
      }
      return {};
    },
    ProjectAdd: async (tx, userId, cmd, ctx) =>
      cmd.type === "ProjectAdd"
        ? await handleProjectAdd(tx, userId, cmd.args, ctx)
        : {},
    ProjectUpdate: async (tx, userId, cmd, ctx) =>
      cmd.type === "ProjectUpdate"
        ? await handleProjectUpdate(tx, userId, cmd.args, ctx.tempIdMapping)
        : {},
    ProjectDelete: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "ProjectDelete") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        assertMutated(await tx.deleteProject(id, userId), "Project", id);
      }
      return {};
    },
    SectionAdd: async (tx, userId, cmd, ctx) =>
      cmd.type === "SectionAdd"
        ? await handleSectionAdd(tx, userId, cmd.args, ctx)
        : {},
    SectionUpdate: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "SectionUpdate") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        const res = await tx.updateSection(id, userId, {
          name: cmd.args.name,
          sectionOrder: cmd.args.section_order,
          isArchived: cmd.args.is_archived,
        });
        assertMutated(res !== null, "Section", id);
      }
      return {};
    },
    SectionDelete: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "SectionDelete") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        assertMutated(await tx.deleteSection(id, userId), "Section", id);
      }
      return {};
    },
    LabelAdd: async (tx, userId, cmd, ctx) =>
      cmd.type === "LabelAdd"
        ? await handleLabelAdd(tx, userId, cmd.args, ctx)
        : {},
    LabelUpdate: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "LabelUpdate") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        const res = await tx.updateLabel(id, userId, {
          name: cmd.args.name,
          color: cmd.args.color,
          itemOrder: cmd.args.item_order,
          isFavorite: cmd.args.is_favorite,
        });
        assertMutated(res !== null, "Label", id);
      }
      return {};
    },
    LabelDelete: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "LabelDelete") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        assertMutated(await tx.deleteLabel(id, userId), "Label", id);
      }
      return {};
    },
    ReminderAdd: async (tx, userId, cmd, ctx) =>
      cmd.type === "ReminderAdd"
        ? await handleReminderAdd(tx, userId, cmd.args, ctx)
        : {},
    ReminderUpdate: async (tx, userId, cmd, ctx) =>
      cmd.type === "ReminderUpdate"
        ? await handleReminderUpdate(tx, userId, cmd.args, ctx.tempIdMapping)
        : {},
    ReminderDelete: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "ReminderDelete") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        assertMutated(await tx.deleteReminder(id, userId), "Reminder", id);
      }
      return {};
    },
    FilterAdd: async (tx, userId, cmd, ctx) =>
      cmd.type === "FilterAdd"
        ? await handleFilterAdd(tx, userId, cmd.args, ctx)
        : {},
    FilterUpdate: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "FilterUpdate") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        const res = await tx.updateFilter(id, userId, {
          name: cmd.args.name,
          query: cmd.args.query,
          color: cmd.args.color,
          itemOrder: cmd.args.item_order,
          isFavorite: cmd.args.is_favorite,
        });
        assertMutated(res !== null, "Filter", id);
      }
      return {};
    },
    FilterDelete: async (tx, userId, cmd, ctx) => {
      if (cmd.type === "FilterDelete") {
        const id = resolveRequiredId(cmd.args.id, ctx.tempIdMapping);
        assertMutated(await tx.deleteFilter(id, userId), "Filter", id);
      }
      return {};
    },
  };
