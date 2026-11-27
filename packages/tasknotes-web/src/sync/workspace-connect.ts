import {
  clearSession,
  connectionOrigin,
  loadSession,
  saveSession,
  verifyPrincipal,
  type SavedSession,
  type VerifiedSession,
} from "./session.ts";
import type { SyncFetch } from "./sync.ts";
import { connectedKey, LOGOUT_KEY } from "./workspace-state.ts";
import {
  createWorkspace,
  LOCAL_WORKSPACE_KEY,
  type WorkspaceStorage,
} from "./workspace-storage.ts";
import { attachLocalEntries, reconcileBatch } from "./workspace-sync.ts";
import {
  requestWorkspaceSync,
  type BrowserSessionStores,
  type WorkspaceLock,
} from "./workspace-transport.ts";

export type ConnectionInput = {
  token: string;
  remember: boolean;
  origin?: string;
};

type ConnectEnvironment = {
  storage: WorkspaceStorage;
  stores: BrowserSessionStores;
  pageOrigin: string;
  fetchImpl?: SyncFetch | undefined;
  lock: WorkspaceLock;
  signal: AbortSignal;
};

export async function establishConnection(
  input: ConnectionInput,
  attachLocal: boolean,
  environment: ConnectEnvironment,
): Promise<{ key: string; session: VerifiedSession }> {
  const { storage, stores, pageOrigin, fetchImpl, lock, signal } = environment;
  const origin = connectionOrigin(input.origin ?? "", pageOrigin);
  const token = input.token.trim();
  const principal = await verifyPrincipal({ origin, token, fetchImpl, signal });
  if (attachLocal && !principal.scopes.includes("write")) {
    throw new Error(
      "Connecting local changes requires a token with write access.",
    );
  }
  const key = connectedKey(origin, principal.user_id, pageOrigin);
  const session: VerifiedSession = {
    origin,
    token,
    remember: input.remember,
    principal,
    logoutEpoch: stores.local.getItem(LOGOUT_KEY + key) ?? "",
  };
  await lock(key, async () => {
    signal.throwIfAborted();
    const response = await requestWorkspaceSync(session, [], {
      signal,
      fetchImpl,
    });
    if (!response.full_sync)
      throw new Error("Facet could not load the connected workspace.");
    signal.throwIfAborted();
    const previous = loadSession(stores);
    saveSession(stores, session);
    try {
      const keys = attachLocal ? [key, LOCAL_WORKSPACE_KEY] : [key];
      await storage.update(keys, (records) => {
        signal.throwIfAborted();
        const initial = records.get(key) ?? createWorkspace();
        const connected = reconcileBatch(initial, {
          sent: [],
          response,
          resources: response,
          now: new Date().toISOString(),
        });
        const local = attachLocal
          ? records.get(LOCAL_WORKSPACE_KEY)
          : undefined;
        if (local === undefined) {
          records.set(key, connected);
          return;
        }
        records.set(key, attachLocalEntries(local, connected));
        records.delete(LOCAL_WORKSPACE_KEY);
      });
    } catch (error) {
      if (!signal.aborted) restoreSession(stores, previous);
      throw error;
    }
  });
  return { key, session };
}

function restoreSession(
  stores: BrowserSessionStores,
  prior: SavedSession | null,
): void {
  if (prior === null) clearSession(stores);
  else saveSession(stores, prior);
}
