import type { WorkspacePrincipal } from "./session.ts";
import { emptyWorkspace, type WorkspaceData } from "./sync.ts";
import type { RejectedChange, WorkspaceRecord } from "./workspace-storage.ts";

export type WorkspaceProfile =
  | { kind: "local"; key: string }
  | { kind: "connected"; key: string; principal: WorkspacePrincipal };

export type WorkspaceSnapshot = {
  phase: "loading" | "setup" | "ready";
  profile: WorkspaceProfile | null;
  data: WorkspaceData;
  syncStatus: "idle" | "local" | "syncing" | "synced" | "offline" | "error";
  error: string | null;
  pendingCount: number;
  rejected: RejectedChange[];
  tempIdMapping: Record<string, string>;
  lastSyncedAt: string | null;
  canWrite: boolean;
  transportOrigin: string;
};

export const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  phase: "loading",
  profile: null,
  data: emptyWorkspace(),
  syncStatus: "idle",
  error: null,
  pendingCount: 0,
  rejected: [],
  tempIdMapping: {},
  lastSyncedAt: null,
  canWrite: false,
  transportOrigin: "",
};

export const LOGOUT_KEY = "tasknotes.web.logout:";

export function snapshotForRecord(
  profile: WorkspaceProfile,
  record: WorkspaceRecord,
  transportOrigin: string,
): Partial<WorkspaceSnapshot> {
  const rejected = record.outbox.flatMap(({ queued, rejection }) =>
    rejection === undefined
      ? []
      : [{ uuid: queued.uuid, command: queued.command, error: rejection }],
  );
  return {
    phase: "ready",
    profile,
    data: record.data,
    rejected,
    pendingCount:
      profile.kind === "local" ? 0 : record.outbox.length - rejected.length,
    tempIdMapping: record.tempIdMapping,
    lastSyncedAt: record.lastSyncedAt,
    canWrite:
      profile.kind === "local" || profile.principal.scopes.includes("write"),
    transportOrigin,
  };
}

export function syncCompletion(
  snapshot: WorkspaceSnapshot,
): Partial<WorkspaceSnapshot> {
  const needsWriteAccess = snapshot.pendingCount > 0 && !snapshot.canWrite;
  return {
    syncStatus:
      !needsWriteAccess && snapshot.rejected.length === 0 ? "synced" : "error",
    error:
      snapshot.rejected[0]?.error ??
      (needsWriteAccess
        ? "Pending changes need a token with write access."
        : null),
  };
}

export function connectedKey(
  origin: string,
  userId: string,
  pageOrigin: string,
): string {
  return JSON.stringify([origin || pageOrigin, userId]);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Facet could not complete this action.";
}

export function resolvedDraftKey(record: WorkspaceRecord, key: string): string {
  return Object.hasOwn(record.tempIdMapping, key)
    ? (record.tempIdMapping[key] ?? key)
    : key;
}

export function workspaceLock(
  name: string,
  action: () => Promise<void>,
): Promise<void> {
  return navigator.locks.request(name, action);
}
