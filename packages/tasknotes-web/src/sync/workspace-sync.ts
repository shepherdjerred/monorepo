import type {
  QueuedCommand,
  SyncCommand,
  SyncResponse,
  TaskMoveEntry,
  TaskScheduleEntry,
} from "@shepherdjerred/facet-protocol";
import { applyLocal, LOCAL_INBOX_ID } from "./local-projection.ts";
import { mergeSync, queuedCommand } from "./sync.ts";
import {
  projectWorkspace,
  type OutboxEntry,
  type WorkspaceRecord,
} from "./workspace-storage.ts";

const ATTACHMENT_BATCH_LIMIT = 24 * 1024 * 1024;

export type PendingCommand = { command: SyncCommand; tempId?: string };

export function newEntry(
  input: PendingCommand,
  createdAt: string,
): OutboxEntry {
  const tempId = input.command.type.endsWith("Add")
    ? (input.tempId ?? crypto.randomUUID())
    : undefined;
  return {
    queued: queuedCommand(input.command, {
      uuid: crypto.randomUUID(),
      ...(tempId === undefined ? {} : { tempId }),
    }),
    createdAt,
  };
}

export function appendEntries(
  record: WorkspaceRecord,
  entries: OutboxEntry[],
): WorkspaceRecord {
  return {
    ...record,
    data: entries.reduce(
      (data, entry) => applyLocal(data, entry.queued, entry.createdAt),
      record.data,
    ),
    outbox: [...record.outbox, ...entries],
  };
}

export function remapQueued(
  queued: QueuedCommand,
  mapping: Record<string, string>,
): QueuedCommand {
  if (Object.keys(mapping).length === 0) return queued;
  const updated = structuredClone(queued);
  const args = updated.command.args;
  const remap = (id: string) =>
    Object.hasOwn(mapping, id) ? (mapping[id] ?? id) : id;
  remapReferences(args, remap);
  if ("tasks" in args) {
    for (const item of args.tasks) remapReferences(item, remap);
  }
  return updated;
}

function remapReferences(
  args: SyncCommand["args"] | TaskMoveEntry | TaskScheduleEntry,
  remap: (id: string) => string,
): void {
  if ("id" in args) args.id = remap(args.id);
  if ("section_id" in args) args.section_id = remap(args.section_id);
  if ("parent_id" in args) args.parent_id = remap(args.parent_id);
  if ("project_id" in args) args.project_id = remap(args.project_id);
  if ("task_id" in args) args.task_id = remap(args.task_id);
  if ("label_ids" in args)
    args.label_ids = args.label_ids.map((id) => remap(id));
}

export function activeBatch(record: WorkspaceRecord): QueuedCommand[] {
  const commands: QueuedCommand[] = [];
  let encodedBytes = 0;
  for (const { queued, rejection } of record.outbox) {
    if (rejection !== undefined) continue;
    const { command } = queued;
    if (command.type === "TaskUpdate") {
      encodedBytes +=
        command.args.append_comment?.attachment_base64?.length ?? 0;
    }
    if (commands.length > 0 && encodedBytes > ATTACHMENT_BATCH_LIMIT) break;
    commands.push(queued);
  }
  return commands;
}

export function reconcileBatch(
  record: WorkspaceRecord,
  input: {
    sent: QueuedCommand[];
    response: SyncResponse;
    resources: SyncResponse;
    now: string;
  },
): WorkspaceRecord {
  const { sent, response, resources, now } = input;
  const statuses = new Map(
    sent.map(({ uuid }) => {
      const status = Object.hasOwn(response.sync_status, uuid)
        ? response.sync_status[uuid]
        : undefined;
      if (status === undefined)
        throw new Error("The sync response did not acknowledge every change.");
      return [uuid, status];
    }),
  );
  const mapping = { ...record.tempIdMapping, ...response.temp_id_mapping };
  const drafts = Object.fromEntries(
    Object.entries(record.drafts).map(([key, draft]) => [
      Object.hasOwn(response.temp_id_mapping, key)
        ? (response.temp_id_mapping[key] ?? key)
        : key,
      draft,
    ]),
  );
  const outbox = record.outbox.flatMap((entry) => {
    const status = statuses.get(entry.queued.uuid);
    if (status === "ok") return [];
    const queued = remapQueued(entry.queued, response.temp_id_mapping);
    return [
      {
        ...entry,
        queued,
        ...(status === undefined ? {} : { rejection: status }),
      },
    ];
  });
  return projectWorkspace({
    ...record,
    base: mergeSync(record.base, resources),
    outbox,
    tempIdMapping: mapping,
    lastSyncedAt: now,
    drafts,
  });
}

export function attachLocalEntries(
  local: WorkspaceRecord,
  connected: WorkspaceRecord,
): WorkspaceRecord {
  const inbox = connected.base.projects.find(
    (item) => item.is_inbox && !item.is_deleted,
  );
  if (inbox === undefined)
    throw new Error("The connected workspace has no Inbox.");
  const mapping = { ...connected.tempIdMapping, [LOCAL_INBOX_ID]: inbox.id };
  const known = new Set(connected.outbox.map((item) => item.queued.uuid));
  const transferred = local.outbox
    .filter((item) => !known.has(item.queued.uuid))
    .map((item) => ({ ...item, queued: remapQueued(item.queued, mapping) }));
  return projectWorkspace({
    ...connected,
    outbox: [...connected.outbox, ...transferred],
    tempIdMapping: mapping,
    drafts: { ...connected.drafts, ...local.drafts },
  });
}

export function retryOutboxDraft(
  record: WorkspaceRecord,
  uuid: string,
  replacement?: SyncCommand,
): WorkspaceRecord {
  const outbox = record.outbox.map((entry) => {
    if (entry.queued.uuid !== uuid || entry.rejection === undefined)
      return entry;
    const { rejection: _rejection, ...pending } = entry;
    return replacement === undefined
      ? pending
      : {
          ...pending,
          queued: remapQueued(
            { ...entry.queued, command: replacement },
            record.tempIdMapping,
          ),
        };
  });
  return projectWorkspace({ ...record, outbox });
}

export function discardOutboxDraft(
  record: WorkspaceRecord,
  uuid: string,
): WorkspaceRecord {
  const outbox = record.outbox.filter(
    (entry) => entry.rejection === undefined || entry.queued.uuid !== uuid,
  );
  return projectWorkspace({ ...record, outbox });
}
