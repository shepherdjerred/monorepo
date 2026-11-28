import {
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
  signal?: AbortSignal | undefined;
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
    cache: "no-store",
    redirect: "error",
    ...(input.signal === undefined ? {} : { signal: input.signal }),
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
