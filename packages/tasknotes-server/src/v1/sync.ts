import type {
  LabelAddArgs,
  ProjectAddArgs,
  ProjectUpdateArgs,
  QueuedCommand,
  SectionAddArgs,
  SyncCommand,
  SyncRequest,
  SyncResponse,
  TaskAddArgs,
  TaskCompleteArgs,
  TaskUpdateArgs,
} from "../protocol/generated.ts";
import type { FacetStore } from "./types.ts";

type ExtraArgs = {
  id?: string | undefined;
  temp_id?: string | undefined;
};

type CommandContext = {
  queuedTempId?: string | undefined;
  tempIdMapping: Record<string, string>;
};

function computeIsRecurring(rule: string | undefined): boolean | undefined {
  if (rule === undefined) return undefined;
  return rule === "" ? false : true;
}

function resolveId(
  id: string | undefined | null,
  tempIdMapping: Record<string, string>,
): string | undefined {
  if (id === undefined || id === null || id === "") return undefined;
  const mapped = tempIdMapping[id];
  return mapped ?? id;
}

function parseDueDate(dueDate: string | undefined): Date | null | undefined {
  if (dueDate === undefined) return undefined;
  return dueDate === "" ? null : new Date(dueDate);
}

async function resolveTaskProjectId(
  tx: FacetStore,
  userId: string,
  rawProjectId: string,
  tempIdMapping: Record<string, string>,
): Promise<string> {
  const resolvedProjectId = resolveId(rawProjectId, tempIdMapping) ?? "";
  if (resolvedProjectId !== "") return resolvedProjectId;

  const existingProjects = await tx.listProjects({
    userId,
    includeDeleted: false,
  });
  const inbox = existingProjects.find((p) => p.is_inbox) ?? existingProjects[0];
  if (inbox !== undefined) return inbox.id;

  const newInbox = await tx.createProject({
    userId,
    name: "Inbox",
    isInbox: true,
  });
  return newInbox.id;
}

async function applyTaskAdd(
  tx: FacetStore,
  userId: string,
  args: TaskAddArgs & ExtraArgs,
  ctx: CommandContext,
): Promise<void> {
  const taskId = args.id ?? crypto.randomUUID();
  const tempId = ctx.queuedTempId ?? args.temp_id;
  if (tempId !== undefined && tempId !== "") {
    ctx.tempIdMapping[tempId] = taskId;
  }

  const finalProjectId = await resolveTaskProjectId(
    tx,
    userId,
    args.project_id,
    ctx.tempIdMapping,
  );
  const resolvedSectionId = resolveId(args.section_id, ctx.tempIdMapping);
  const resolvedParentId = resolveId(args.parent_id, ctx.tempIdMapping);

  await tx.createTask({
    id: taskId,
    userId,
    projectId: finalProjectId,
    sectionId: resolvedSectionId,
    parentId: resolvedParentId,
    title: args.title,
    description: args.description,
    priority: args.priority,
    childOrder: args.child_order,
    dueDate:
      args.due_date !== undefined && args.due_date !== ""
        ? new Date(args.due_date)
        : undefined,
    dueDatetime:
      args.due_datetime !== undefined && args.due_datetime !== ""
        ? new Date(args.due_datetime)
        : undefined,
    dueTimezone: args.due_timezone,
    dueString: args.due_string,
    isRecurring:
      args.recurrence_rule !== undefined && args.recurrence_rule !== "",
    recurrenceRule: args.recurrence_rule,
  });
}

async function applyTaskUpdate(
  tx: FacetStore,
  args: TaskUpdateArgs,
  tempIdMapping: Record<string, string>,
): Promise<void> {
  const resolvedId = resolveId(args.id, tempIdMapping) ?? args.id;
  const resolvedProjectId = resolveId(args.project_id, tempIdMapping);
  const resolvedSectionId = resolveId(args.section_id, tempIdMapping);
  const resolvedParentId = resolveId(args.parent_id, tempIdMapping);

  await tx.updateTask(resolvedId, {
    title: args.title,
    description: args.description,
    priority: args.priority,
    projectId: resolvedProjectId,
    sectionId: resolvedSectionId,
    parentId: resolvedParentId,
    childOrder: args.child_order,
    dueDate: parseDueDate(args.due_date),
    dueDatetime: parseDueDate(args.due_datetime),
    dueTimezone: args.due_timezone,
    dueString: args.due_string,
    isRecurring: computeIsRecurring(args.recurrence_rule),
    recurrenceRule: args.recurrence_rule,
  });
}

async function applyTaskComplete(
  tx: FacetStore,
  args: TaskCompleteArgs,
  tempIdMapping: Record<string, string>,
): Promise<void> {
  const resolvedId = resolveId(args.id, tempIdMapping) ?? args.id;
  const completedAt =
    args.completed_at !== undefined && args.completed_at !== ""
      ? new Date(args.completed_at)
      : tx.getNow();
  await tx.updateTask(resolvedId, {
    completed: true,
    completedAt,
  });
}

async function applyProjectAdd(
  tx: FacetStore,
  userId: string,
  args: ProjectAddArgs & ExtraArgs,
  ctx: CommandContext,
): Promise<void> {
  const projectId = args.id ?? crypto.randomUUID();
  const tempId = ctx.queuedTempId ?? args.temp_id;
  if (tempId !== undefined && tempId !== "") {
    ctx.tempIdMapping[tempId] = projectId;
  }

  const resolvedParentId = resolveId(args.parent_id, ctx.tempIdMapping);

  await tx.createProject({
    id: projectId,
    userId,
    name: args.name,
    color: args.color,
    parentId: resolvedParentId,
    childOrder: args.child_order,
    isFavorite: args.is_favorite,
  });
}

async function applyProjectUpdate(
  tx: FacetStore,
  args: ProjectUpdateArgs,
  tempIdMapping: Record<string, string>,
): Promise<void> {
  const resolvedId = resolveId(args.id, tempIdMapping) ?? args.id;
  const resolvedParentId = resolveId(args.parent_id, tempIdMapping);

  await tx.updateProject(resolvedId, {
    name: args.name,
    color: args.color,
    parentId: resolvedParentId,
    childOrder: args.child_order,
    isFavorite: args.is_favorite,
    isArchived: args.is_archived,
  });
}

async function applySectionAdd(
  tx: FacetStore,
  userId: string,
  args: SectionAddArgs & ExtraArgs,
  ctx: CommandContext,
): Promise<void> {
  const sectionId = args.id ?? crypto.randomUUID();
  const tempId = ctx.queuedTempId ?? args.temp_id;
  if (tempId !== undefined && tempId !== "") {
    ctx.tempIdMapping[tempId] = sectionId;
  }

  const resolvedProjectId = resolveId(args.project_id, ctx.tempIdMapping) ?? "";

  await tx.createSection({
    id: sectionId,
    userId,
    projectId: resolvedProjectId,
    name: args.name,
    sectionOrder: args.section_order,
  });
}

async function applyLabelAdd(
  tx: FacetStore,
  userId: string,
  args: LabelAddArgs & ExtraArgs,
  ctx: CommandContext,
): Promise<void> {
  const labelId = args.id ?? crypto.randomUUID();
  const tempId = ctx.queuedTempId ?? args.temp_id;
  if (tempId !== undefined && tempId !== "") {
    ctx.tempIdMapping[tempId] = labelId;
  }
  await tx.createLabel({
    id: labelId,
    userId,
    name: args.name,
    color: args.color,
    itemOrder: args.item_order,
    isFavorite: args.is_favorite,
  });
}

type CommandHandler = (
  tx: FacetStore,
  userId: string,
  cmd: SyncCommand,
  ctx: CommandContext,
) => Promise<void>;

const commandHandlers: Record<SyncCommand["type"], CommandHandler> = {
  TaskAdd: async (tx, userId, cmd, ctx) => {
    if (cmd.type === "TaskAdd") {
      await applyTaskAdd(tx, userId, cmd.args, ctx);
    }
  },
  TaskUpdate: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "TaskUpdate") {
      await applyTaskUpdate(tx, cmd.args, ctx.tempIdMapping);
    }
  },
  TaskDelete: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "TaskDelete") {
      await tx.deleteTask(
        resolveId(cmd.args.id, ctx.tempIdMapping) ?? cmd.args.id,
      );
    }
  },
  TaskComplete: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "TaskComplete") {
      await applyTaskComplete(tx, cmd.args, ctx.tempIdMapping);
    }
  },
  TaskUncomplete: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "TaskUncomplete") {
      await tx.updateTask(
        resolveId(cmd.args.id, ctx.tempIdMapping) ?? cmd.args.id,
        {
          completed: false,
          completedAt: null,
        },
      );
    }
  },
  TaskReorder: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "TaskReorder") {
      await tx.updateTask(
        resolveId(cmd.args.id, ctx.tempIdMapping) ?? cmd.args.id,
        {
          childOrder: cmd.args.child_order,
        },
      );
    }
  },
  ProjectAdd: async (tx, userId, cmd, ctx) => {
    if (cmd.type === "ProjectAdd") {
      await applyProjectAdd(tx, userId, cmd.args, ctx);
    }
  },
  ProjectUpdate: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "ProjectUpdate") {
      await applyProjectUpdate(tx, cmd.args, ctx.tempIdMapping);
    }
  },
  ProjectDelete: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "ProjectDelete") {
      await tx.deleteProject(
        resolveId(cmd.args.id, ctx.tempIdMapping) ?? cmd.args.id,
      );
    }
  },
  SectionAdd: async (tx, userId, cmd, ctx) => {
    if (cmd.type === "SectionAdd") {
      await applySectionAdd(tx, userId, cmd.args, ctx);
    }
  },
  SectionUpdate: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "SectionUpdate") {
      await tx.updateSection(
        resolveId(cmd.args.id, ctx.tempIdMapping) ?? cmd.args.id,
        {
          name: cmd.args.name,
          sectionOrder: cmd.args.section_order,
          isArchived: cmd.args.is_archived,
        },
      );
    }
  },
  SectionDelete: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "SectionDelete") {
      await tx.deleteSection(
        resolveId(cmd.args.id, ctx.tempIdMapping) ?? cmd.args.id,
      );
    }
  },
  LabelAdd: async (tx, userId, cmd, ctx) => {
    if (cmd.type === "LabelAdd") {
      await applyLabelAdd(tx, userId, cmd.args, ctx);
    }
  },
  LabelUpdate: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "LabelUpdate") {
      await tx.updateLabel(
        resolveId(cmd.args.id, ctx.tempIdMapping) ?? cmd.args.id,
        {
          name: cmd.args.name,
          color: cmd.args.color,
          itemOrder: cmd.args.item_order,
          isFavorite: cmd.args.is_favorite,
        },
      );
    }
  },
  LabelDelete: async (tx, _userId, cmd, ctx) => {
    if (cmd.type === "LabelDelete") {
      await tx.deleteLabel(
        resolveId(cmd.args.id, ctx.tempIdMapping) ?? cmd.args.id,
      );
    }
  },
};

async function processCommand(
  tx: FacetStore,
  userId: string,
  queued: QueuedCommand,
  tempIdMapping: Record<string, string>,
): Promise<string> {
  if (await tx.isCommandProcessed(queued.uuid)) {
    return "ok";
  }
  try {
    const handler = commandHandlers[queued.command.type];
    const ctx: CommandContext = { queuedTempId: queued.temp_id, tempIdMapping };
    await handler(tx, userId, queued.command, ctx);
    await tx.recordProcessedCommand(queued.uuid, userId, "ok");
    return "ok";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `error: ${message}`;
  }
}

function parseSinceDate(syncToken?: string): Date | undefined {
  if (syncToken === undefined || syncToken === "" || syncToken === "*") {
    return undefined;
  }
  const parsed = new Date(syncToken);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function executeSync(
  store: FacetStore,
  userId: string,
  request: SyncRequest,
): Promise<SyncResponse> {
  return await store.transaction(async (tx) => {
    await tx.getOrCreateUser(userId);

    const tempIdMapping: Record<string, string> = {};
    const syncStatus: Record<string, string> = {};
    const commands: QueuedCommand[] = request.commands;

    for (const queued of commands) {
      if (queued.uuid !== "") {
        syncStatus[queued.uuid] = await processCommand(
          tx,
          userId,
          queued,
          tempIdMapping,
        );
      }
    }

    const sinceDate = parseSinceDate(request.sync_token);
    const isFullSync = sinceDate === undefined;

    const filter = {
      userId,
      since: sinceDate,
      includeDeleted: !isFullSync,
    };

    const types = request.resource_types;
    const includeAll =
      types === undefined || types.length === 0 || types.includes("all");
    const shouldInclude = (t: string) => includeAll || types.includes(t);

    const tasks = shouldInclude("tasks") ? await tx.listTasks(filter) : [];
    const projects = shouldInclude("projects")
      ? await tx.listProjects(filter)
      : [];
    const sections = shouldInclude("sections")
      ? await tx.listSections(filter)
      : [];
    const labels = shouldInclude("labels") ? await tx.listLabels(filter) : [];
    const reminders = shouldInclude("reminders")
      ? await tx.listReminders(filter)
      : [];
    const filters = shouldInclude("filters")
      ? await tx.listFilters(filter)
      : [];

    const nextSyncToken = tx.getNow().toISOString();

    return {
      sync_token: nextSyncToken,
      full_sync: isFullSync,
      temp_id_mapping: tempIdMapping,
      sync_status: syncStatus,
      tasks,
      projects,
      sections,
      labels,
      reminders,
      filters,
    };
  });
}
