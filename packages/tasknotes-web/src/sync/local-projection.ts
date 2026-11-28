import {
  Priority,
  type Filter,
  type Label,
  type Project,
  type QueuedCommand,
  type Reminder,
  type Section,
  type SyncCommand,
  type Task,
  type TaskUpdateArgs,
} from "@shepherdjerred/facet-protocol";
import { taskCompletion } from "@shepherdjerred/facet-protocol/recurrence";
import type { WorkspaceData } from "./sync.ts";

export const LOCAL_INBOX_ID = "local-inbox";

function patchItem<T extends { id: string }>(
  items: T[],
  id: string,
  patch: (item: T) => T,
): T[] {
  return items.map((item) => (item.id === id ? patch(item) : item));
}

function deleteItem<T extends { id: string; is_deleted: boolean }>(
  items: T[],
  id: string,
): T[] {
  return patchItem(items, id, (item) => ({ ...item, is_deleted: true }));
}

function activeInbox(data: WorkspaceData): string {
  return (
    data.projects.find((item) => item.is_inbox && !item.is_deleted)?.id ?? ""
  );
}

function taskFields(
  task: Task,
  args: Omit<TaskUpdateArgs, "id">,
  now: string,
): Task {
  const {
    append_comment: append,
    remove_comment_id: remove,
    remove_attachment_id: detach,
    restore_deleted: restore,
    ...changes
  } = args;
  const updated = { ...task, ...changes, updated_at: now };
  if (changes.project_id === "") updated.project_id = task.project_id;
  if (updated.section_id === "") delete updated.section_id;
  if (updated.parent_id === "") delete updated.parent_id;
  if (updated.due_date === "") delete updated.due_date;
  if (updated.due_datetime === "") delete updated.due_datetime;
  if (updated.due_timezone === "") delete updated.due_timezone;
  if (updated.due_string === "") delete updated.due_string;
  if (updated.deadline === "") delete updated.deadline;
  if (updated.recurrence_rule === "") delete updated.recurrence_rule;
  if (changes.recurrence_rule !== undefined) {
    updated.is_recurring = updated.recurrence_rule !== undefined;
  }
  if (restore === true) updated.is_deleted = false;
  if (remove !== undefined) {
    updated.comments = (updated.comments ?? []).filter(
      (comment) => comment.id !== remove,
    );
  }
  if (detach !== undefined) {
    updated.comments = (updated.comments ?? []).flatMap((comment) => {
      if (comment.id !== detach) return [comment];
      if (comment.body === "") return [];
      const { file_name: _file, ...remaining } = comment;
      return [remaining];
    });
  }
  if (append !== undefined) {
    updated.comments = [
      ...(updated.comments ?? []).filter(
        (comment) => comment.id !== append.comment.id,
      ),
      append.comment,
    ].sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id),
    );
  }
  return updated;
}

function taskProjection(
  data: WorkspaceData,
  command: Extract<SyncCommand, { type: `Task${string}` }>,
  newId: string,
  now: string,
): Task[] {
  switch (command.type) {
    case "TaskAdd": {
      const args = command.args;
      const added = taskFields(
        {
          id: newId,
          user_id: "",
          project_id: args.project_id || activeInbox(data),
          title: args.title,
          description: "",
          priority: Priority.P4,
          child_order: 0,
          is_recurring: false,
          label_ids: [],
          completed: false,
          is_deleted: false,
          created_at: now,
          updated_at: now,
        },
        args,
        now,
      );
      return [...data.tasks, added];
    }
    case "TaskUpdate": {
      const { id, ...changes } = command.args;
      return patchItem(data.tasks, id, (task) =>
        taskFields(task, changes, now),
      );
    }
    case "TaskComplete":
      return patchItem(data.tasks, command.args.id, (task) =>
        completeTask(task, command.args.completed_at ?? now, now),
      );
    case "TaskUncomplete":
      return patchItem(data.tasks, command.args.id, (task) => {
        const { completed_at: _completedAt, ...open } = task;
        return { ...open, completed: false, updated_at: now };
      });
    case "TaskDelete":
      return patchItem(data.tasks, command.args.id, (task) => ({
        ...task,
        is_deleted: true,
        updated_at: now,
      }));
    case "TaskReorder":
      return patchItem(data.tasks, command.args.id, (task) => ({
        ...task,
        child_order: command.args.child_order,
        updated_at: now,
      }));
    case "TaskMove":
    case "TaskReschedule": {
      const updates = new Map(
        command.args.tasks.map(({ id, ...entry }) => [id, entry]),
      );
      return data.tasks.map((task) => {
        const entry = updates.get(task.id);
        if (entry === undefined) return task;
        return command.type === "TaskMove"
          ? taskFields(task, { section_id: "", parent_id: "", ...entry }, now)
          : taskFields(task, entry, now);
      });
    }
  }
}

function completeTask(task: Task, completedAt: string, now: string): Task {
  const result = taskCompletion(task, new Date(completedAt));
  if (result.kind === "completed") {
    return {
      ...task,
      completed: true,
      completed_at: completedAt,
      updated_at: now,
    };
  }
  const { completed_at: _completedAt, ...open } = task;
  return taskFields(
    { ...open, completed: false },
    {
      recurrence_rule: result.recurrenceRule,
      ...(result.dueDate === undefined
        ? {}
        : { due_date: result.dueDate.toISOString().slice(0, 10) }),
      ...(result.dueDatetime === undefined
        ? {}
        : { due_datetime: result.dueDatetime.toISOString() }),
    },
    now,
  );
}

export function applyLocal(
  data: WorkspaceData,
  queued: QueuedCommand,
  now: string,
): WorkspaceData {
  const command = queued.command;
  const id = queued.temp_id ?? queued.uuid;
  return command.type === "TaskAdd" ||
    command.type === "TaskUpdate" ||
    command.type === "TaskComplete" ||
    command.type === "TaskUncomplete" ||
    command.type === "TaskDelete" ||
    command.type === "TaskReorder" ||
    command.type === "TaskMove" ||
    command.type === "TaskReschedule"
    ? { ...data, tasks: taskProjection(data, command, id, now) }
    : collectionProjection(data, command, id, now);
}

function collectionProjection(
  data: WorkspaceData,
  command: Exclude<SyncCommand, { type: `Task${string}` }>,
  id: string,
  now: string,
): WorkspaceData {
  const identity = { id, user_id: "", is_deleted: false };
  const timestamps = { created_at: now, updated_at: now };
  switch (command.type) {
    case "ProjectAdd": {
      const project: Project = {
        ...identity,
        ...timestamps,
        color: "gray",
        child_order: 0,
        is_favorite: false,
        is_inbox: false,
        is_archived: false,
        ...command.args,
      };
      return { ...data, projects: [...data.projects, project] };
    }
    case "ProjectUpdate":
      return {
        ...data,
        projects: patchItem(data.projects, command.args.id, (item) => {
          const updated = { ...item, ...command.args, updated_at: now };
          if (updated.parent_id === "") delete updated.parent_id;
          return updated;
        }),
      };
    case "ProjectDelete":
      return { ...data, projects: deleteItem(data.projects, command.args.id) };
    case "SectionAdd": {
      const section: Section = {
        ...identity,
        ...timestamps,
        section_order: 0,
        is_archived: false,
        ...command.args,
      };
      return { ...data, sections: [...data.sections, section] };
    }
    case "SectionUpdate":
      return {
        ...data,
        sections: patchItem(data.sections, command.args.id, (item) => ({
          ...item,
          ...command.args,
          updated_at: now,
        })),
      };
    case "SectionDelete":
      return { ...data, sections: deleteItem(data.sections, command.args.id) };
    case "LabelAdd": {
      const label: Label = {
        ...identity,
        color: "gray",
        item_order: 0,
        is_favorite: false,
        ...command.args,
      };
      return { ...data, labels: [...data.labels, label] };
    }
    case "LabelUpdate":
      return {
        ...data,
        labels: patchItem(data.labels, command.args.id, (item) => ({
          ...item,
          ...command.args,
        })),
      };
    case "LabelDelete":
      return {
        ...data,
        labels: deleteItem(data.labels, command.args.id),
      };
    case "FilterAdd": {
      const filter: Filter = {
        ...identity,
        color: "gray",
        item_order: 0,
        is_favorite: false,
        ...command.args,
      };
      return { ...data, filters: [...data.filters, filter] };
    }
    case "FilterUpdate":
      return {
        ...data,
        filters: patchItem(data.filters, command.args.id, (item) => ({
          ...item,
          ...command.args,
        })),
      };
    case "FilterDelete":
      return { ...data, filters: deleteItem(data.filters, command.args.id) };
    case "ReminderAdd": {
      const reminder: Reminder = {
        id,
        updated_at: now,
        is_deleted: false,
        is_notified: false,
        ...command.args,
      };
      return { ...data, reminders: [...data.reminders, reminder] };
    }
    case "ReminderUpdate":
      return {
        ...data,
        reminders: patchItem(data.reminders, command.args.id, (item) => ({
          ...item,
          ...command.args,
          updated_at: now,
        })),
      };
    case "ReminderDelete":
      return {
        ...data,
        reminders: deleteItem(data.reminders, command.args.id),
      };
  }
}
