import type { QueuedCommand } from "@shepherdjerred/facet-protocol";
import {
  syncEndpoint,
  type KeyValueStore,
  type SavedSession,
} from "./session.ts";
import { commandFailure, postSync, type SyncFetch } from "./sync.ts";
import type { WorkspaceRecord } from "./workspace-storage.ts";
import { activeBatch, reconcileBatch } from "./workspace-sync.ts";

export type BrowserSessionStores = {
  local: KeyValueStore;
  session: KeyValueStore;
};
export type WorkspaceLock = (
  name: string,
  action: () => Promise<void>,
) => Promise<void>;

type SyncTransport = {
  signal: AbortSignal;
  fetchImpl?: SyncFetch | undefined;
  syncToken?: string | undefined;
};

export function requestWorkspaceSync(
  session: SavedSession,
  commands: QueuedCommand[],
  transport: SyncTransport,
) {
  return postSync({
    endpoint: syncEndpoint(session.origin),
    token: session.token,
    commands,
    ...transport,
  });
}

type SyncWorkspace = {
  read: () => Promise<WorkspaceRecord>;
  update: (
    reconcile: (current: WorkspaceRecord) => WorkspaceRecord,
  ) => Promise<void>;
  canWrite: boolean;
};

export async function flushWorkspace(
  session: SavedSession,
  workspace: SyncWorkspace,
  transport: SyncTransport,
): Promise<void> {
  let pulled = false;
  while (!transport.signal.aborted) {
    const record = await workspace.read();
    const sent = workspace.canWrite ? activeBatch(record) : [];
    if (pulled && sent.length === 0) return;
    const response = await requestWorkspaceSync(session, sent, {
      ...transport,
      syncToken: record.base.syncToken,
    });
    const resources =
      response.full_sync || commandFailure(response) === undefined
        ? response
        : await requestWorkspaceSync(session, [], transport);
    transport.signal.throwIfAborted();
    const now = new Date().toISOString();
    await workspace.update((current) =>
      reconcileBatch(current, { sent, response, resources, now }),
    );
    pulled = true;
  }
}
