import type { SyncCommand } from "@shepherdjerred/facet-protocol";
import {
  clearSession,
  connectionOrigin,
  loadSession,
  verifyPrincipal,
  type VerifiedSession,
} from "./session.ts";
import { SyncHttpError, type SyncFetch } from "./sync.ts";
import { loadAttachment } from "./workspace-attachments.ts";
import {
  establishConnection,
  type ConnectionInput,
} from "./workspace-connect.ts";
import {
  createWorkspace,
  IndexedWorkspaceStorage,
  LOCAL_WORKSPACE_KEY,
  type WorkspaceRecord,
  type WorkspaceStorage,
} from "./workspace-storage.ts";
import {
  appendEntries,
  discardOutboxDraft,
  newEntry,
  remapQueued,
  retryOutboxDraft,
  type PendingCommand,
} from "./workspace-sync.ts";

import {
  connectedKey,
  EMPTY_SNAPSHOT,
  errorMessage,
  LOGOUT_KEY,
  resolvedDraftKey,
  snapshotForRecord,
  syncCompletion,
  workspaceLock,
  type WorkspaceProfile,
  type WorkspaceSnapshot,
} from "./workspace-state.ts";

import {
  flushWorkspace,
  type BrowserSessionStores,
  type WorkspaceLock,
} from "./workspace-transport.ts";

type Receipt = { uuid: string; tempId?: string };

type EngineOptions = {
  storage?: WorkspaceStorage;
  stores?: BrowserSessionStores;
  fetchImpl?: SyncFetch;
  pageOrigin?: string;
  lock?: WorkspaceLock;
};

const LOCAL_MODE_KEY = "tasknotes.web.local";

export class WorkspaceEngine {
  private snapshot: WorkspaceSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly storage: WorkspaceStorage;
  private readonly lock: WorkspaceLock;
  private readonly options: EngineOptions;
  private session: VerifiedSession | null = null;
  private sessionAction = new AbortController();
  private channel?: BroadcastChannel;
  private initial?: Promise<void>;
  private syncing: Promise<void> | undefined;
  private syncRequests = 0;

  constructor(options: EngineOptions = {}) {
    this.options = options;
    this.storage = options.storage ?? new IndexedWorkspaceStorage();
    this.lock = options.lock ?? workspaceLock;
  }

  readonly getSnapshot = (): WorkspaceSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  initialize(): Promise<void> {
    this.initial ??= this.load();
    return this.initial;
  }

  private stores(): BrowserSessionStores {
    return (
      this.options.stores ?? { local: localStorage, session: sessionStorage }
    );
  }

  private get pageOrigin(): string {
    return this.options.pageOrigin ?? location.origin;
  }

  private setSnapshot(changes: Partial<WorkspaceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) listener();
  }

  private applyRecord(
    profile: WorkspaceProfile,
    record: WorkspaceRecord,
  ): void {
    this.setSnapshot(
      snapshotForRecord(profile, record, this.session?.origin ?? ""),
    );
  }

  private async readRecord(key: string): Promise<WorkspaceRecord> {
    const record = await this.storage.read(key);
    if (record === undefined)
      throw new Error("This workspace is no longer stored on this browser.");
    return record;
  }

  private requireProfile(write = false): WorkspaceProfile {
    const profile = this.snapshot.profile;
    if (profile === null || (write && !this.snapshot.canWrite)) {
      throw new Error(
        write ? "This workspace is read-only." : "Open a workspace first.",
      );
    }
    return profile;
  }

  private async refreshFromDisk(): Promise<void> {
    const profile = this.snapshot.profile;
    if (profile === null) return;
    const record = await this.storage.read(profile.key);
    if (this.snapshot.profile?.key !== profile.key) return;
    if (record === undefined) {
      this.lockWorkspace();
      return;
    }
    this.applyRecord(this.requireProfile(), record);
  }

  private notifyOtherTabs(): void {
    this.channel?.postMessage("changed");
  }

  private async onWorkspaceChanged(): Promise<void> {
    try {
      await this.refreshFromDisk();
    } catch (error) {
      this.setSnapshot({ syncStatus: "error", error: errorMessage(error) });
    }
  }

  private browserEvents(): void {
    if (typeof window === "undefined") return;
    this.channel = new BroadcastChannel("facet-workspace");
    this.channel.addEventListener("message", () => {
      void this.onWorkspaceChanged();
    });
    globalThis.addEventListener("storage", (event) => {
      if (!(event instanceof StorageEvent)) return;
      const profile = this.snapshot.profile;
      if (
        profile?.kind === "connected" &&
        event.key === LOGOUT_KEY + profile.key &&
        event.newValue !== this.session?.logoutEpoch
      ) {
        this.lockWorkspace();
      }
    });
    globalThis.addEventListener("online", () => {
      void this.sync();
    });
    globalThis.addEventListener("focus", () => {
      void this.sync();
    });
  }

  private async load(): Promise<void> {
    try {
      this.browserEvents();
      const stores = this.stores();
      const saved = loadSession(stores);
      if (saved !== null) {
        const origin = connectionOrigin(saved.origin, this.pageOrigin);
        if (saved.principal !== undefined) {
          const key = connectedKey(
            origin,
            saved.principal.user_id,
            this.pageOrigin,
          );
          if (
            (saved.logoutEpoch ?? "") !==
            (stores.local.getItem(LOGOUT_KEY + key) ?? "")
          ) {
            clearSession(stores);
            this.setSnapshot({ phase: "setup" });
            return;
          }
          const record = await this.storage.read(key);
          if (record !== undefined) {
            this.session = { ...saved, origin, principal: saved.principal };
            this.applyRecord(
              { kind: "connected", key, principal: saved.principal },
              record,
            );
            void this.sync();
            return;
          }
        }
        await this.connect({ ...saved, origin });
        return;
      }
      if (stores.local.getItem(LOCAL_MODE_KEY) === "1") {
        await this.startLocal();
        return;
      }
      this.setSnapshot({ phase: "setup" });
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 401)
        clearSession(this.stores());
      this.setSnapshot({ phase: "setup", error: errorMessage(error) });
    }
  }

  private beginChange(): AbortSignal {
    this.sessionAction.abort();
    this.sessionAction = new AbortController();
    return this.sessionAction.signal;
  }

  async startLocal(): Promise<void> {
    const signal = this.beginChange();
    const key = LOCAL_WORKSPACE_KEY;
    await this.storage.update([key], (records) => {
      signal.throwIfAborted();
      if (!records.has(key)) records.set(key, createWorkspace(true));
    });
    signal.throwIfAborted();
    this.session = null;
    const stores = this.stores();
    clearSession(stores);
    stores.local.setItem(LOCAL_MODE_KEY, "1");
    this.setSnapshot({ syncStatus: "local", error: null });
    this.applyRecord({ kind: "local", key }, await this.readRecord(key));
  }

  async connect(
    input: ConnectionInput,
    options: { attachLocal?: boolean } = {},
  ): Promise<void> {
    const signal = this.beginChange();
    this.setSnapshot({ syncStatus: "syncing", error: null });
    try {
      const stores = this.stores();
      const { key, session } = await establishConnection(
        input,
        options.attachLocal === true,
        {
          stores,
          storage: this.storage,
          pageOrigin: this.pageOrigin,
          fetchImpl: this.options.fetchImpl,
          lock: this.lock,
          signal,
        },
      );
      const record = await this.readRecord(key);
      signal.throwIfAborted();
      this.session = session;
      stores.local.removeItem(LOCAL_MODE_KEY);
      this.setSnapshot({ syncStatus: "synced" });
      this.applyRecord(
        { kind: "connected", key, principal: session.principal },
        record,
      );
      this.notifyOtherTabs();
      void this.sync();
    } catch (error) {
      if (!signal.aborted)
        this.setSnapshot({ syncStatus: "error", error: errorMessage(error) });
      throw error;
    }
  }

  async enqueue(
    command: SyncCommand,
    options: { tempId?: string } = {},
  ): Promise<Receipt> {
    const [receipt] = await this.enqueueBatch([{ command, ...options }]);
    if (receipt === undefined)
      throw new Error("Facet did not save this change.");
    return receipt;
  }

  async enqueueBatch(inputs: PendingCommand[]): Promise<Receipt[]> {
    const profile = this.requireProfile(true);
    const now = new Date().toISOString();
    const entries = inputs.map((input) => newEntry(input, now));
    await this.updateRecord(profile, (record) =>
      appendEntries(
        record,
        entries.map((entry) => ({
          ...entry,
          queued: remapQueued(entry.queued, record.tempIdMapping),
        })),
      ),
    );
    if (profile.kind === "connected") void this.sync();
    return entries.map(({ queued }) => ({
      uuid: queued.uuid,
      ...(queued.temp_id === undefined ? {} : { tempId: queued.temp_id }),
    }));
  }

  private async updateRecord(
    profile: WorkspaceProfile,
    update: (record: WorkspaceRecord) => WorkspaceRecord,
  ): Promise<void> {
    await this.storage.update([profile.key], (records) => {
      if (this.snapshot.profile?.key !== profile.key)
        throw new Error("The active workspace changed.");
      const record = records.get(profile.key);
      if (record === undefined)
        throw new Error("This workspace is no longer stored on this browser.");
      records.set(profile.key, update(record));
    });
    await this.refreshFromDisk();
    this.notifyOtherTabs();
  }

  async getDraft(key: string): Promise<unknown> {
    const record = await this.readRecord(this.requireProfile().key);
    const draftKey = resolvedDraftKey(record, key);
    return Object.hasOwn(record.drafts, draftKey)
      ? record.drafts[draftKey]
      : undefined;
  }

  async saveDraft(key: string, value: unknown): Promise<void> {
    await this.updateRecord(this.requireProfile(true), (record) => ({
      ...record,
      drafts: { ...record.drafts, [resolvedDraftKey(record, key)]: value },
    }));
  }

  async clearDraft(key: string): Promise<void> {
    await this.updateRecord(this.requireProfile(), (record) => {
      const draftKey = resolvedDraftKey(record, key);
      const drafts = Object.fromEntries(
        Object.entries(record.drafts).filter(([name]) => name !== draftKey),
      );
      return { ...record, drafts };
    });
  }

  async retryRejected(uuid: string, replacement?: SyncCommand): Promise<void> {
    await this.updateRecord(this.requireProfile(true), (record) =>
      retryOutboxDraft(record, uuid, replacement),
    );
    await this.sync();
  }

  async removeRejected(uuid: string): Promise<void> {
    await this.updateRecord(this.requireProfile(), (record) =>
      discardOutboxDraft(record, uuid),
    );
  }

  async attachment(taskId: string, commentId: string): Promise<Blob> {
    const signal = this.sessionAction.signal;
    const record = await this.readRecord(this.requireProfile().key);
    signal.throwIfAborted();
    return await loadAttachment(taskId, commentId, {
      record,
      session: this.session,
      fetchImpl: this.options.fetchImpl,
      signal,
    });
  }

  sync(): Promise<void> {
    if (this.session === null) return Promise.resolve();
    this.syncRequests += 1;
    this.syncing ??= this.runSync();
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    try {
      let covered: number;
      do {
        covered = this.syncRequests;
        await this.syncOnce();
      } while (covered !== this.syncRequests);
    } finally {
      this.syncing = undefined;
    }
  }

  private async syncOnce(): Promise<void> {
    const profile = this.snapshot.profile;
    const session = this.session;
    const signal = this.sessionAction.signal;
    if (session === null || profile?.kind !== "connected") return;
    this.setSnapshot({ syncStatus: "syncing", error: null });
    try {
      await this.lock(profile.key, async () => {
        signal.throwIfAborted();
        const transport = { fetchImpl: this.options.fetchImpl, signal };
        const principal = await verifyPrincipal({
          origin: session.origin,
          token: session.token,
          ...transport,
        });
        if (principal.user_id !== session.principal.user_id)
          throw new SyncHttpError(401);
        const record = await this.readRecord(profile.key);
        signal.throwIfAborted();
        const verified = { ...profile, principal };
        this.session = { ...session, principal };
        this.applyRecord(verified, record);
        await flushWorkspace(
          session,
          {
            read: () => this.readRecord(profile.key),
            update: (reconcile) => this.updateRecord(verified, reconcile),
            canWrite: this.snapshot.canWrite,
          },
          transport,
        );
      });
      if (!signal.aborted) this.setSnapshot(syncCompletion(this.snapshot));
    } catch (error) {
      if (!signal.aborted) this.syncFailure(error);
    }
  }

  private syncFailure(error: unknown): void {
    if (error instanceof SyncHttpError && error.status === 401) {
      this.signOut();
      this.setSnapshot({ error: errorMessage(error) });
      return;
    }
    const offline =
      error instanceof TypeError ||
      (typeof navigator !== "undefined" && !navigator.onLine);
    this.setSnapshot({
      syncStatus: offline ? "offline" : "error",
      error: offline
        ? "Offline. Changes are saved on this browser and will sync when you reconnect."
        : errorMessage(error),
    });
  }

  private lockWorkspace(): void {
    this.beginChange();
    this.session = null;
    const stores = this.stores();
    clearSession(stores);
    stores.local.removeItem(LOCAL_MODE_KEY);
    this.setSnapshot({ ...EMPTY_SNAPSHOT, phase: "setup" });
  }

  signOut(): void {
    const profile = this.snapshot.profile;
    if (profile?.kind === "connected") {
      this.stores().local.setItem(
        LOGOUT_KEY + profile.key,
        crypto.randomUUID(),
      );
    }
    this.lockWorkspace();
  }

  async removeLocalData(): Promise<void> {
    const profile = this.requireProfile();
    this.signOut();
    const remove = () =>
      this.storage.update([profile.key], (records) => {
        records.delete(profile.key);
      });
    if (profile.kind === "connected") await this.lock(profile.key, remove);
    else await remove();
    this.notifyOtherTabs();
  }
}

export const workspaceEngine = new WorkspaceEngine();
