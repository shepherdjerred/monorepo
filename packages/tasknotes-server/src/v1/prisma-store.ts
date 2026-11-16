import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import type {
  Filter,
  Label,
  Project,
  Reminder,
  Section,
  Task,
} from "../protocol/generated.ts";
import {
  type CreateLabelInput,
  type CreateProjectInput,
  type CreateSectionInput,
  type CreateTaskInput,
  type FacetStore,
  type ListFiltersFilter,
  type ListLabelsFilter,
  type ListProjectsFilter,
  type ListRemindersFilter,
  type ListSectionsFilter,
  type ListTasksFilter,
  type UpdateLabelInput,
  type UpdateProjectInput,
  type UpdateSectionInput,
  type UpdateTaskInput,
  toProtocolFilter,
  toProtocolLabel,
  toProtocolProject,
  toProtocolReminder,
  toProtocolSection,
  toProtocolTask,
} from "./types.ts";

function buildTaskUpdateBasic(
  data: UpdateTaskInput,
  target: Prisma.TaskUpdateInput,
): void {
  if (data.title !== undefined) target.title = data.title;
  if (data.description !== undefined) target.description = data.description;
  if (data.priority !== undefined) target.priority = data.priority;
  if (data.projectId !== undefined)
    target.project = { connect: { id: data.projectId } };
  if (data.sectionId !== undefined) {
    target.section =
      data.sectionId === null
        ? { disconnect: true }
        : { connect: { id: data.sectionId } };
  }
  if (data.parentId !== undefined) target.parentId = data.parentId;
  if (data.childOrder !== undefined) target.childOrder = data.childOrder;
}

function buildTaskUpdateDates(
  data: UpdateTaskInput,
  target: Prisma.TaskUpdateInput,
): void {
  if (data.dueDate !== undefined) target.dueDate = data.dueDate;
  if (data.dueDatetime !== undefined) target.dueDatetime = data.dueDatetime;
  if (data.dueTimezone !== undefined) target.dueTimezone = data.dueTimezone;
  if (data.dueString !== undefined) target.dueString = data.dueString;
  if (data.isRecurring !== undefined) target.isRecurring = data.isRecurring;
  if (data.recurrenceRule !== undefined)
    target.recurrenceRule = data.recurrenceRule;
  if (data.completed !== undefined) target.completed = data.completed;
  if (data.completedAt !== undefined) target.completedAt = data.completedAt;
  if (data.isDeleted !== undefined) target.isDeleted = data.isDeleted;
}

function buildTaskUpdateData(data: UpdateTaskInput): Prisma.TaskUpdateInput {
  const updateData: Prisma.TaskUpdateInput = {};
  buildTaskUpdateBasic(data, updateData);
  buildTaskUpdateDates(data, updateData);
  return updateData;
}

export class PrismaFacetStore implements FacetStore {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  getNow(): Date {
    return new Date();
  }

  async transaction<T>(fn: (tx: FacetStore) => Promise<T>): Promise<T> {
    if ("$transaction" in this.prisma) {
      return await this.prisma.$transaction(
        async (txClient: Prisma.TransactionClient) => {
          const txStore = new PrismaFacetStore(txClient);
          return await fn(txStore);
        },
      );
    }
    return await fn(this);
  }

  async getOrCreateUser(
    userId: string,
  ): Promise<{ id: string; email: string; name: string }> {
    const user = await this.prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${userId}@tasknotes.local`,
        name: "Default User",
      },
      update: {},
    });
    return { id: user.id, email: user.email, name: user.name };
  }

  async isCommandProcessed(uuid: string): Promise<boolean> {
    const found = await this.prisma.processedCommand.findUnique({
      where: { uuid },
    });
    return found !== null;
  }

  async recordProcessedCommand(
    uuid: string,
    userId: string,
    status: string,
  ): Promise<void> {
    await this.prisma.processedCommand.upsert({
      where: { uuid },
      create: { uuid, userId, status },
      update: { status },
    });
  }

  async createTask(data: CreateTaskInput): Promise<Task> {
    const id = data.id ?? crypto.randomUUID();
    const created = await this.prisma.task.create({
      data: {
        id,
        userId: data.userId,
        projectId: data.projectId,
        sectionId: data.sectionId ?? null,
        parentId: data.parentId ?? null,
        title: data.title,
        description: data.description ?? "",
        priority: data.priority ?? "P4",
        childOrder: data.childOrder ?? 0,
        dueDate: data.dueDate ?? null,
        dueDatetime: data.dueDatetime ?? null,
        dueTimezone: data.dueTimezone ?? null,
        dueString: data.dueString ?? null,
        isRecurring: data.isRecurring ?? false,
        recurrenceRule: data.recurrenceRule ?? null,
        completed: data.completed ?? false,
        completedAt: data.completedAt ?? null,
      },
    });
    return toProtocolTask(created);
  }

  async updateTask(id: string, data: UpdateTaskInput): Promise<Task | null> {
    try {
      const updateData = buildTaskUpdateData(data);
      const updated = await this.prisma.task.update({
        where: { id },
        data: updateData,
      });
      return toProtocolTask(updated);
    } catch {
      return null;
    }
  }

  async deleteTask(id: string): Promise<boolean> {
    try {
      await this.prisma.task.update({
        where: { id },
        data: { isDeleted: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  async getTask(id: string, userId?: string): Promise<Task | null> {
    const where: Prisma.TaskWhereInput = { id };
    if (userId !== undefined && userId !== "") where.userId = userId;
    const task = await this.prisma.task.findFirst({ where });
    return task === null ? null : toProtocolTask(task);
  }

  async listTasks(filter: ListTasksFilter): Promise<Task[]> {
    const where: Prisma.TaskWhereInput = { userId: filter.userId };
    if (filter.projectId !== undefined && filter.projectId !== "") {
      where.projectId = filter.projectId;
    }
    if (filter.includeDeleted !== true) where.isDeleted = false;
    if (filter.since !== undefined) where.updatedAt = { gt: filter.since };

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: { childOrder: "asc" },
    });
    return tasks.map((task) => toProtocolTask(task));
  }

  async createProject(data: CreateProjectInput): Promise<Project> {
    const id = data.id ?? crypto.randomUUID();
    const created = await this.prisma.project.create({
      data: {
        id,
        userId: data.userId,
        name: data.name,
        color: data.color ?? "charcoal",
        parentId: data.parentId ?? null,
        childOrder: data.childOrder ?? 0,
        isInbox: data.isInbox ?? false,
        isFavorite: data.isFavorite ?? false,
        isArchived: data.isArchived ?? false,
      },
    });
    return toProtocolProject(created);
  }

  async updateProject(
    id: string,
    data: UpdateProjectInput,
  ): Promise<Project | null> {
    try {
      const updateData: Prisma.ProjectUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.color !== undefined) updateData.color = data.color;
      if (data.parentId !== undefined) updateData.parentId = data.parentId;
      if (data.childOrder !== undefined)
        updateData.childOrder = data.childOrder;
      if (data.isFavorite !== undefined)
        updateData.isFavorite = data.isFavorite;
      if (data.isArchived !== undefined)
        updateData.isArchived = data.isArchived;
      if (data.isDeleted !== undefined) updateData.isDeleted = data.isDeleted;

      const updated = await this.prisma.project.update({
        where: { id },
        data: updateData,
      });
      return toProtocolProject(updated);
    } catch {
      return null;
    }
  }

  async deleteProject(id: string): Promise<boolean> {
    try {
      await this.prisma.project.update({
        where: { id },
        data: { isDeleted: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  async getProject(id: string, userId?: string): Promise<Project | null> {
    const where: Prisma.ProjectWhereInput = { id };
    if (userId !== undefined && userId !== "") where.userId = userId;
    const project = await this.prisma.project.findFirst({ where });
    return project === null ? null : toProtocolProject(project);
  }

  async listProjects(filter: ListProjectsFilter): Promise<Project[]> {
    const where: Prisma.ProjectWhereInput = { userId: filter.userId };
    if (filter.includeDeleted !== true) where.isDeleted = false;
    if (filter.since !== undefined) where.updatedAt = { gt: filter.since };

    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { childOrder: "asc" },
    });
    return projects.map((p) => toProtocolProject(p));
  }

  async createSection(data: CreateSectionInput): Promise<Section> {
    const id = data.id ?? crypto.randomUUID();
    const created = await this.prisma.section.create({
      data: {
        id,
        userId: data.userId,
        projectId: data.projectId,
        name: data.name,
        sectionOrder: data.sectionOrder ?? 0,
      },
    });
    return toProtocolSection(created);
  }

  async updateSection(
    id: string,
    data: UpdateSectionInput,
  ): Promise<Section | null> {
    try {
      const updateData: Prisma.SectionUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.sectionOrder !== undefined)
        updateData.sectionOrder = data.sectionOrder;
      if (data.isArchived !== undefined)
        updateData.isArchived = data.isArchived;
      if (data.isDeleted !== undefined) updateData.isDeleted = data.isDeleted;

      const updated = await this.prisma.section.update({
        where: { id },
        data: updateData,
      });
      return toProtocolSection(updated);
    } catch {
      return null;
    }
  }

  async deleteSection(id: string): Promise<boolean> {
    try {
      await this.prisma.section.update({
        where: { id },
        data: { isDeleted: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  async listSections(filter: ListSectionsFilter): Promise<Section[]> {
    const where: Prisma.SectionWhereInput = { userId: filter.userId };
    if (filter.projectId !== undefined && filter.projectId !== "") {
      where.projectId = filter.projectId;
    }
    if (filter.includeDeleted !== true) where.isDeleted = false;
    if (filter.since !== undefined) where.updatedAt = { gt: filter.since };

    const sections = await this.prisma.section.findMany({
      where,
      orderBy: { sectionOrder: "asc" },
    });
    return sections.map((s) => toProtocolSection(s));
  }

  async createLabel(data: CreateLabelInput): Promise<Label> {
    const id = data.id ?? crypto.randomUUID();
    const created = await this.prisma.label.create({
      data: {
        id,
        userId: data.userId,
        name: data.name,
        color: data.color ?? "grey",
        itemOrder: data.itemOrder ?? 0,
        isFavorite: data.isFavorite ?? false,
      },
    });
    return toProtocolLabel(created);
  }

  async updateLabel(id: string, data: UpdateLabelInput): Promise<Label | null> {
    try {
      const updateData: Prisma.LabelUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.color !== undefined) updateData.color = data.color;
      if (data.itemOrder !== undefined) updateData.itemOrder = data.itemOrder;
      if (data.isFavorite !== undefined)
        updateData.isFavorite = data.isFavorite;
      if (data.isDeleted !== undefined) updateData.isDeleted = data.isDeleted;

      const updated = await this.prisma.label.update({
        where: { id },
        data: updateData,
      });
      return toProtocolLabel(updated);
    } catch {
      return null;
    }
  }

  async deleteLabel(id: string): Promise<boolean> {
    try {
      await this.prisma.label.update({
        where: { id },
        data: { isDeleted: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  async listLabels(filter: ListLabelsFilter): Promise<Label[]> {
    const where: Prisma.LabelWhereInput = { userId: filter.userId };
    if (filter.includeDeleted !== true) where.isDeleted = false;
    if (filter.since !== undefined) where.updatedAt = { gt: filter.since };

    const labels = await this.prisma.label.findMany({
      where,
      orderBy: { itemOrder: "asc" },
    });
    return labels.map((l) => toProtocolLabel(l));
  }

  async listReminders(filter: ListRemindersFilter): Promise<Reminder[]> {
    const where: Prisma.ReminderWhereInput = {
      task: { userId: filter.userId },
    };
    if (filter.includeDeleted !== true) where.isDeleted = false;
    if (filter.since !== undefined) where.createdAt = { gt: filter.since };

    const reminders = await this.prisma.reminder.findMany({ where });
    return reminders.map((r) => toProtocolReminder(r));
  }

  async listFilters(filter: ListFiltersFilter): Promise<Filter[]> {
    const where: Prisma.FilterWhereInput = { userId: filter.userId };
    if (filter.includeDeleted !== true) where.isDeleted = false;
    if (filter.since !== undefined) where.updatedAt = { gt: filter.since };

    const filters = await this.prisma.filter.findMany({
      where,
      orderBy: { itemOrder: "asc" },
    });
    return filters.map((f) => toProtocolFilter(f));
  }
}
