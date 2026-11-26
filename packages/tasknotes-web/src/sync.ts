import {
  Priority,
  type Filter,
  type Label,
  type Project,
  type QueuedCommand,
  type Reminder,
  type Section,
  type SyncCommand,
  type SyncRequest,
  type SyncResponse,
  type Task,
  type TaskAddArgs,
  type TaskCompleteArgs,
  type TaskDeleteArgs,
  type TaskRescheduleArgs,
  type TaskScheduleEntry,
  type TaskUncompleteArgs,
  type TaskUpdateArgs,
} from "@shepherdjerred/facet-protocol";
import { SyncResponseSchema } from "./sync-response.ts";

export type WorkspaceData = {
  syncToken?: string;
  tasks: Task[];
  projects: Project[];
  sections: Section[];
  labels: Label[];
  reminders: Reminder[];
  filters: Filter[];
};

export function emptyWorkspace(): WorkspaceData {
  return {
    tasks: [],
    projects: [],
    sections: [],
    labels: [],
    reminders: [],
    filters: [],
  };
}

function upsert<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function mergeSync(
  current: WorkspaceData,
  response: SyncResponse,
): WorkspaceData {
  if (response.full_sync) {
    return {
      syncToken: response.sync_token,
      tasks: response.tasks,
      projects: response.projects,
      sections: response.sections,
      labels: response.labels,
      reminders: response.reminders,
      filters: response.filters,
    };
  }
  return {
    syncToken: response.sync_token,
    tasks: upsert(current.tasks, response.tasks),
    projects: upsert(current.projects, response.projects),
    sections: upsert(current.sections, response.sections),
    labels: upsert(current.labels, response.labels),
    reminders: upsert(current.reminders, response.reminders),
    filters: upsert(current.filters, response.filters),
  };
}

export function commandFailure(response: SyncResponse): string | undefined {
  for (const status of Object.values(response.sync_status)) {
    if (status !== "ok") return status;
  }
  return undefined;
}

export type CommandIds = { uuid: string; tempId?: string };

export function queuedCommand(
  command: SyncCommand,
  ids: CommandIds,
): QueuedCommand {
  return ids.tempId === undefined
    ? { uuid: ids.uuid, command }
    : { uuid: ids.uuid, temp_id: ids.tempId, command };
}

export function taskAddCommand(
  args: TaskAddArgs,
  ids: CommandIds & { tempId: string },
): QueuedCommand {
  return queuedCommand({ type: "TaskAdd", args }, ids);
}

export function taskUpdateCommand(
  args: TaskUpdateArgs,
  ids: CommandIds,
): QueuedCommand {
  return queuedCommand({ type: "TaskUpdate", args }, ids);
}

export function taskCompleteCommand(
  args: TaskCompleteArgs,
  ids: CommandIds,
): QueuedCommand {
  return queuedCommand({ type: "TaskComplete", args }, ids);
}

export function taskUncompleteCommand(
  args: TaskUncompleteArgs,
  ids: CommandIds,
): QueuedCommand {
  return queuedCommand({ type: "TaskUncomplete", args }, ids);
}

export function taskDeleteCommand(
  args: TaskDeleteArgs,
  ids: CommandIds,
): QueuedCommand {
  return queuedCommand({ type: "TaskDelete", args }, ids);
}

export function taskRescheduleCommand(
  tasks: TaskScheduleEntry[],
  ids: CommandIds,
): QueuedCommand {
  const args: TaskRescheduleArgs = { tasks };
  return queuedCommand({ type: "TaskReschedule", args }, ids);
}

function withoutDue(
  task: Task,
): Omit<Task, "due_date" | "due_datetime" | "due_string"> {
  const {
    due_date: _dueDate,
    due_datetime: _dueDatetime,
    due_string: _dueString,
    ...rest
  } = task;
  return rest;
}

function withDue(task: Task, dueDate: string | undefined): Task {
  if (dueDate === undefined) return task;
  const cleared = withoutDue(task);
  return dueDate === "" ? cleared : { ...cleared, due_date: dueDate };
}

function addTask(
  data: WorkspaceData,
  queued: QueuedCommand,
  args: TaskAddArgs,
  nowIso: string,
): WorkspaceData {
  const id = queued.temp_id ?? queued.uuid;
  const added: Task = withDue(
    {
      id,
      user_id: "",
      project_id: args.project_id,
      title: args.title,
      description: args.description ?? "",
      priority: args.priority ?? Priority.P4,
      child_order: args.child_order ?? 0,
      is_recurring: false,
      label_ids: args.label_ids ?? [],
      completed: false,
      is_deleted: false,
      created_at: nowIso,
      updated_at: nowIso,
    },
    args.due_date,
  );
  return { ...data, tasks: [...data.tasks, added] };
}

function updateTask(
  data: WorkspaceData,
  args: TaskUpdateArgs,
  nowIso: string,
): WorkspaceData {
  return {
    ...data,
    tasks: data.tasks.map((task) => {
      if (task.id !== args.id) return task;
      return withDue(
        {
          ...task,
          updated_at: nowIso,
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.description === undefined
            ? {}
            : { description: args.description }),
          ...(args.priority === undefined ? {} : { priority: args.priority }),
          ...(args.project_id === undefined
            ? {}
            : { project_id: args.project_id }),
          ...(args.label_ids === undefined
            ? {}
            : { label_ids: args.label_ids }),
        },
        args.due_date,
      );
    }),
  };
}

function mapTask(
  data: WorkspaceData,
  id: string,
  update: (task: Task) => Task,
): WorkspaceData {
  return {
    ...data,
    tasks: data.tasks.map((task) => (task.id === id ? update(task) : task)),
  };
}

export function applyLocal(
  data: WorkspaceData,
  queued: QueuedCommand,
  nowIso: string,
): WorkspaceData {
  const command = queued.command;
  if (command.type === "TaskAdd")
    return addTask(data, queued, command.args, nowIso);
  if (command.type === "TaskUpdate")
    return updateTask(data, command.args, nowIso);
  if (command.type === "TaskComplete") {
    return mapTask(data, command.args.id, (task) => ({
      ...task,
      completed: true,
      completed_at: command.args.completed_at ?? nowIso,
      updated_at: nowIso,
    }));
  }
  if (command.type === "TaskUncomplete") {
    return mapTask(data, command.args.id, (task) => ({
      ...openedTask(task),
      completed: false,
      updated_at: nowIso,
    }));
  }
  if (command.type === "TaskDelete") {
    return mapTask(data, command.args.id, (task) => ({
      ...task,
      is_deleted: true,
      updated_at: nowIso,
    }));
  }
  if (command.type === "TaskReschedule") {
    return {
      ...data,
      tasks: data.tasks.map((task) => {
        const entry = command.args.tasks.find((item) => item.id === task.id);
        return entry === undefined
          ? task
          : { ...withDue(task, entry.due_date), updated_at: nowIso };
      }),
    };
  }
  return data;
}

function openedTask(task: Task): Omit<Task, "completed_at"> {
  const { completed_at: _completedAt, ...rest } = task;
  return rest;
}

export class SyncHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      status === 401
        ? "The server rejected that token."
        : `The server returned ${status.toString()}.`,
    );
    this.name = "SyncHttpError";
    this.status = status;
  }
}

export type SyncFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function postSync(input: {
  endpoint: string;
  token: string;
  syncToken?: string | undefined;
  commands: QueuedCommand[];
  fetchImpl?: SyncFetch | undefined;
}): Promise<SyncResponse> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (input.token !== "") headers["authorization"] = `Bearer ${input.token}`;
  const body: SyncRequest = { commands: input.commands };
  if (input.syncToken !== undefined && input.syncToken !== "") {
    body.sync_token = input.syncToken;
  }
  const response = await (input.fetchImpl ?? fetch)(input.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new SyncHttpError(response.status);
  const payload: unknown = await response.json();
  const parsed = SyncResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      "The server returned a sync response TaskNotes could not read.",
    );
  }
  return parsed.data;
}
