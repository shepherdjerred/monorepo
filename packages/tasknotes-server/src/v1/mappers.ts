import {
  tasksCreatedTotal,
  tasksDeletedTotal,
  tasksUpdatedTotal,
} from "../metrics.ts";
import {
  type Filter,
  type Label,
  Priority,
  RecurrenceBasis,
  type Project,
  type Reminder,
  type Section,
  type Task,
} from "../protocol/generated.ts";

export function recordTaskMutationMetric(
  kind: "created" | "updated" | "deleted",
): void {
  if (kind === "created") {
    tasksCreatedTotal.inc();
    return;
  }
  if (kind === "deleted") {
    tasksDeletedTotal.inc();
    return;
  }
  tasksUpdatedTotal.inc();
}

export function parsePriority(priority: string | undefined): Priority {
  if (priority === Priority.P1) {
    return Priority.P1;
  }
  if (priority === Priority.P2) {
    return Priority.P2;
  }
  return priority === Priority.P3 ? Priority.P3 : Priority.P4;
}

function applyTaskDates(
  result: Task,
  p: {
    dueDate: Date | null;
    dueDatetime: Date | null;
    completedAt: Date | null;
  },
): void {
  if (p.dueDate !== null) {
    const formatted = p.dueDate.toISOString().split("T")[0];
    if (formatted !== undefined && formatted !== "") {
      result.due_date = formatted;
    }
  }
  if (p.dueDatetime !== null) {
    result.due_datetime = p.dueDatetime.toISOString();
  }
  if (p.completedAt !== null) {
    result.completed_at = p.completedAt.toISOString();
  }
}

function applyTaskStrings(
  result: Task,
  p: {
    sectionId: string | null;
    parentId: string | null;
    dueTimezone: string | null;
    dueString: string | null;
    recurrenceRule: string | null;
  },
): void {
  if (p.sectionId !== null && p.sectionId !== "") {
    result.section_id = p.sectionId;
  }
  if (p.parentId !== null && p.parentId !== "") {
    result.parent_id = p.parentId;
  }
  if (p.dueTimezone !== null && p.dueTimezone !== "") {
    result.due_timezone = p.dueTimezone;
  }
  if (p.dueString !== null && p.dueString !== "") {
    result.due_string = p.dueString;
  }
  if (p.recurrenceRule !== null && p.recurrenceRule !== "") {
    result.recurrence_rule = p.recurrenceRule;
  }
}

export function toProtocolTask(
  p: {
    id: string;
    userId: string;
    projectId: string;
    sectionId: string | null;
    parentId: string | null;
    title: string;
    description: string;
    priority: string;
    childOrder: number;
    dueDate: Date | null;
    dueDatetime: Date | null;
    dueTimezone: string | null;
    dueString: string | null;
    deadline: Date | null;
    recurrenceBasis: keyof typeof RecurrenceBasis | null;
    isRecurring: boolean;
    recurrenceRule: string | null;
    completed: boolean;
    completedAt: Date | null;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  labelIds: string[] = [],
): Task {
  const result: Task = {
    id: p.id,
    user_id: p.userId,
    project_id: p.projectId,
    title: p.title,
    description: p.description,
    priority: parsePriority(p.priority),
    child_order: p.childOrder,
    is_recurring: p.isRecurring,
    label_ids: labelIds,
    completed: p.completed,
    is_deleted: p.isDeleted,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };

  applyTaskStrings(result, p);
  applyTaskDates(result, p);
  if (p.deadline !== null)
    result.deadline = p.deadline.toISOString().slice(0, 10);
  if (p.recurrenceBasis !== null)
    result.recurrence_basis = RecurrenceBasis[p.recurrenceBasis];
  return result;
}

export function toProtocolProject(p: {
  id: string;
  userId: string;
  name: string;
  color: string;
  parentId: string | null;
  childOrder: number;
  isInbox: boolean;
  isFavorite: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Project {
  const result: Project = {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    color: p.color,
    child_order: p.childOrder,
    is_inbox: p.isInbox,
    is_favorite: p.isFavorite,
    is_archived: p.isArchived,
    is_deleted: p.isDeleted,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };

  if (p.parentId !== null && p.parentId !== "") {
    result.parent_id = p.parentId;
  }

  return result;
}

export function toProtocolSection(p: {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  sectionOrder: number;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Section {
  return {
    id: p.id,
    project_id: p.projectId,
    user_id: p.userId,
    name: p.name,
    section_order: p.sectionOrder,
    is_archived: p.isArchived,
    is_deleted: p.isDeleted,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

export function toProtocolLabel(p: {
  id: string;
  userId: string;
  name: string;
  color: string;
  itemOrder: number;
  isFavorite: boolean;
  isDeleted: boolean;
}): Label {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    color: p.color,
    item_order: p.itemOrder,
    is_favorite: p.isFavorite,
    is_deleted: p.isDeleted,
  };
}

export function toProtocolReminder(p: {
  id: string;
  taskId: string;
  reminderType: string;
  minuteOffset: number | null;
  dueDatetime: Date | null;
  isNotified: boolean;
  isDeleted: boolean;
  updatedAt: Date;
}): Reminder {
  const result: Reminder = {
    id: p.id,
    task_id: p.taskId,
    reminder_type: p.reminderType,
    is_notified: p.isNotified,
    is_deleted: p.isDeleted,
    updated_at: p.updatedAt.toISOString(),
  };
  if (p.minuteOffset !== null) {
    result.minute_offset = p.minuteOffset;
  }
  if (p.dueDatetime !== null) {
    result.due_datetime = p.dueDatetime.toISOString();
  }
  return result;
}

export function toProtocolFilter(p: {
  id: string;
  userId: string;
  name: string;
  query: string;
  color: string;
  itemOrder: number;
  isFavorite: boolean;
  isDeleted: boolean;
}): Filter {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    query: p.query,
    color: p.color,
    item_order: p.itemOrder,
    is_favorite: p.isFavorite,
    is_deleted: p.isDeleted,
  };
}
