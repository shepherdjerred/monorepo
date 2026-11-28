import type {
  QueuedCommand,
  SyncCommand,
} from "@shepherdjerred/facet-protocol";
import { z } from "zod";
import { applyLocal, LOCAL_INBOX_ID } from "./local-projection.ts";
import { WorkspaceResourcesSchema } from "./sync-response.ts";
import { emptyWorkspace, type WorkspaceData } from "./sync.ts";

export const LOCAL_WORKSPACE_KEY = "local";

export type OutboxEntry = {
  queued: QueuedCommand;
  createdAt: string;
  rejection?: string;
};

export type RejectedChange = {
  uuid: string;
  command: SyncCommand;
  error: string;
};

export type WorkspaceRecord = {
  version: 1;
  base: WorkspaceData;
  data: WorkspaceData;
  outbox: OutboxEntry[];
  tempIdMapping: Record<string, string>;
  lastSyncedAt: string | null;
  drafts: Record<string, unknown>;
};

export function createWorkspace(
  local = false,
  now = new Date().toISOString(),
): WorkspaceRecord {
  const base = emptyWorkspace();
  if (local) {
    base.projects.push({
      id: LOCAL_INBOX_ID,
      user_id: "",
      name: "Inbox",
      color: "gray",
      child_order: 0,
      is_inbox: true,
      is_favorite: false,
      is_archived: false,
      is_deleted: false,
      created_at: now,
      updated_at: now,
    });
  }
  return {
    version: 1,
    base,
    data: base,
    outbox: [],
    tempIdMapping: {},
    lastSyncedAt: null,
    drafts: {},
  };
}

export function projectWorkspace(record: WorkspaceRecord): WorkspaceRecord {
  return {
    ...record,
    data: record.outbox.reduce(
      (data, entry) =>
        entry.rejection === undefined
          ? applyLocal(data, entry.queued, entry.createdAt)
          : data,
      record.base,
    ),
  };
}

export type WorkspaceStorage = {
  read: (key: string) => Promise<WorkspaceRecord | undefined>;
  update: (
    keys: string[],
    transform: (read: Map<string, WorkspaceRecord>) => void,
  ) => Promise<void>;
};

const WorkspaceDataSchema = WorkspaceResourcesSchema.extend({
  syncToken: z.string().optional(),
});
const WorkspaceRecordShape = z.object({
  version: z.literal(1),
  base: WorkspaceDataSchema,
  data: WorkspaceDataSchema,
  outbox: z.array(
    z.object({
      queued: z.object({
        uuid: z.string(),
        temp_id: z.string().optional(),
        command: z.object({
          type: z.string(),
          args: z.record(z.string(), z.unknown()),
        }),
      }),
      createdAt: z.string(),
      rejection: z.string().optional(),
    }),
  ),
  tempIdMapping: z.record(z.string(), z.string()),
  lastSyncedAt: z.string().nullable(),
  drafts: z.record(z.string(), z.unknown()),
});
const WorkspaceRecordSchema = z.custom<WorkspaceRecord>(
  (value) => WorkspaceRecordShape.safeParse(value).success,
);

function storedRecord(value: unknown): WorkspaceRecord | undefined {
  if (value === undefined) return undefined;
  const parsed = WorkspaceRecordSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Facet could not read its saved workspace on this browser.",
    );
  return parsed.data;
}

const STORE = "workspaces";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("facet-workspace", 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(STORE);
    });
    request.addEventListener("success", () => {
      request.result.addEventListener("versionchange", () => {
        request.result.close();
      });
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Facet storage is unavailable."));
    });
  });
}

export class IndexedWorkspaceStorage implements WorkspaceStorage {
  private database?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    this.database ??= openDatabase();
    return this.database;
  }

  async read(key: string): Promise<WorkspaceRecord | undefined> {
    const database = await this.open();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).get(key);
      request.addEventListener("error", () => {
        reject(
          request.error ?? new Error("Facet could not load its workspace."),
        );
      });
      request.addEventListener("success", () => {
        try {
          resolve(storedRecord(request.result));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Facet could not load its workspace."),
          );
        }
      });
    });
  }

  async update(
    keys: string[],
    transform: (records: Map<string, WorkspaceRecord>) => void,
  ): Promise<void> {
    const database = await this.open();
    const distinctKeys = [...new Set(keys)];
    if (distinctKeys.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const records = new Map<string, WorkspaceRecord>();
      let remaining = distinctKeys.length;
      transaction.addEventListener("complete", () => {
        resolve();
      });
      transaction.addEventListener("abort", () => {
        reject(
          transaction.error ??
            new Error("Facet could not save this change to your browser."),
        );
      });
      for (const key of distinctKeys) {
        const request = store.get(key);
        request.addEventListener("success", () => {
          try {
            const record = storedRecord(request.result);
            if (record !== undefined) records.set(key, record);
            remaining -= 1;
            if (remaining > 0) return;
            transform(records);
            for (const itemKey of distinctKeys) {
              const next = records.get(itemKey);
              if (next === undefined) store.delete(itemKey);
              else store.put(next, itemKey);
            }
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error(
                    "Facet could not save this change to your browser.",
                  ),
            );
            transaction.abort();
          }
        });
      }
    });
  }
}
