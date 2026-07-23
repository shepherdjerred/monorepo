import { z } from "zod";

import { TypedStorage } from "../cache/storage";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../../domain/types";
import { taskId } from "../../domain/types";
import type { TaskStatus } from "../../domain/status";
import type { CommandQueue, DeadLetterEntry } from "../sync/CommandQueue";
import {
  type Clock,
  type Command,
  applyCommand,
  commandTarget,
  makeCommandIdFactory,
  makeTempId,
} from "../sync/commands";

/**
 * The single source of truth the UI reads.
 *
 * `base` is the last server snapshot; the visible task map is always
 * `rebase(base, queue.pending)` — recomputed on every change, never
 * persisted. That is the core offline-first invariant: the only durable
 * writes are the command queue (on dispatch) and the base cache (on server
 * acks/pulls), so no crash can ever capture a half-applied optimistic state.
 *
 * The store NEVER touches the network. Executing commands is the
 * SyncEngine's job; it reports results back through `applyServerAck` /
 * `replaceBase`.
 */

export type TaskStoreSnapshot = {
  readonly tasks: ReadonlyMap<TaskId, Task>;
  readonly pendingCount: number;
  /** Tasks with at least one unsynced pending command (quiet trust signal). */
  readonly pendingTaskIds: ReadonlySet<TaskId>;
  readonly deadLetters: readonly DeadLetterEntry[];
  readonly lastSyncTime: number | null;
};

/** Mutations as the UI expresses them — ids/timestamps are filled in here. */
export type DispatchInput =
  | { readonly type: "create"; readonly payload: CreateTaskRequest }
  | {
      readonly type: "update";
      readonly taskId: TaskId;
      readonly payload: UpdateTaskRequest;
    }
  | { readonly type: "delete"; readonly taskId: TaskId }
  | {
      readonly type: "set_status";
      readonly taskId: TaskId;
      readonly status: TaskStatus;
    }
  | {
      readonly type: "set_instance_complete";
      readonly taskId: TaskId;
      readonly date: string;
      readonly completed: boolean;
    };

export type TaskStoreStorage = {
  getTasks: () => Promise<Task[]>;
  setTasks: (tasks: Task[]) => Promise<void>;
  getIdAliases: () => Promise<string | null>;
  setIdAliases: (data: string) => Promise<void>;
  getLastSyncTime: () => Promise<number | null>;
  setLastSyncTime: (time: number) => Promise<void>;
};

const defaultStorage: TaskStoreStorage = {
  getTasks: () => TypedStorage.getTasks(),
  setTasks: (tasks) => TypedStorage.setTasks(tasks),
  getIdAliases: () => TypedStorage.getIdAliases(),
  setIdAliases: (data) => TypedStorage.setIdAliases(data),
  getLastSyncTime: () => TypedStorage.getLastSyncTime(),
  setLastSyncTime: (time) => TypedStorage.setLastSyncTime(time),
};

const AliasesSchema = z.record(z.string(), z.string());

export class TaskStore {
  private base = new Map<TaskId, Task>();
  private aliases = new Map<TaskId, TaskId>();
  private lastSyncTime: number | null = null;
  private snapshot: TaskStoreSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly nextCommandId: () => string;

  /** Wired to SyncEngine.requestSync — fired after every dispatch. */
  onDispatch: (() => void) | null = null;

  constructor(
    private readonly queue: CommandQueue,
    private readonly storage: TaskStoreStorage = defaultStorage,
    private readonly clock: Clock = Date.now,
  ) {
    this.nextCommandId = makeCommandIdFactory(clock);
    this.snapshot = this.buildSnapshot();
  }

  /** Load queue + cached base + aliases. Call once at startup, after migrations. */
  async restore(): Promise<void> {
    await this.queue.restore();
    const [tasks, rawAliases, lastSync] = await Promise.all([
      this.storage.getTasks(),
      this.storage.getIdAliases(),
      this.storage.getLastSyncTime(),
    ]);
    this.base = new Map(tasks.map((t) => [t.id, t]));
    this.aliases = parseAliases(rawAliases);
    this.lastSyncTime = lastSync;
    this.recompute();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): TaskStoreSnapshot {
    return this.snapshot;
  }

  /**
   * Record a mutation and return the optimistic result immediately. The
   * enqueue is the only await — never the network. Returns the task as the
   * UI will now see it (undefined after a delete).
   */
  async dispatch(input: DispatchInput): Promise<Task | undefined> {
    const command = this.buildCommand(input);
    await this.queue.enqueue(command);
    this.recompute();
    this.onDispatch?.();
    const target = command.type === "create" ? command.tempId : command.taskId;
    return this.snapshot.tasks.get(target);
  }

  /**
   * Follow the temp→real alias if one exists. UI surfaces holding a task id
   * from before a create was acked (an open detail screen, a deep link) stay
   * valid across the remap.
   */
  resolveTaskId(id: TaskId): TaskId {
    return this.aliases.get(id) ?? id;
  }

  /**
   * A command was accepted by the server. Merge the authoritative result
   * into the base, drop the command, and for creates record the temp→real
   * alias and rewrite every queued command that referenced the temp id.
   */
  async applyServerAck(
    command: Command,
    serverTask: Task | null,
  ): Promise<void> {
    if (command.type === "create" && serverTask !== null) {
      this.aliases.set(command.tempId, serverTask.id);
      await this.queue.remapTaskId(command.tempId, serverTask.id);
      await this.persistAliases();
    }
    if (command.type === "delete") {
      this.base.delete(command.taskId);
    } else if (serverTask !== null) {
      this.base.set(serverTask.id, serverTask);
    }
    await this.queue.ack(command.id);
    await this.persistBase();
    this.recompute();
  }

  /** A command failed permanently — park it and roll back its optimistic effect. */
  async deadLetterCommand(
    ...args: Parameters<CommandQueue["deadLetter"]>
  ): Promise<void> {
    await this.queue.deadLetter(...args);
    this.recompute();
  }

  async retryDeadLetter(id: string): Promise<void> {
    await this.queue.retryDeadLetter(id);
    this.recompute();
    this.onDispatch?.();
  }

  async discardDeadLetter(id: string): Promise<void> {
    await this.queue.discardDeadLetter(id);
    this.recompute();
  }

  /** Replace the base with a fresh full pull and prune stale aliases. */
  async replaceBase(tasks: Task[], syncedAt: number): Promise<void> {
    this.base = new Map(tasks.map((t) => [t.id, t]));
    for (const [tempId, realId] of this.aliases) {
      if (!this.base.has(realId)) this.aliases.delete(tempId);
    }
    this.lastSyncTime = syncedAt;
    await this.persistBase();
    await this.persistAliases();
    await this.storage.setLastSyncTime(syncedAt);
    this.recompute();
  }

  private buildCommand(input: DispatchInput): Command {
    const base = { id: this.nextCommandId(), createdAt: this.clock() };
    switch (input.type) {
      case "create":
        return { ...base, ...input, tempId: makeTempId(this.clock) };
      case "update":
      case "delete":
      case "set_status":
      case "set_instance_complete":
        return {
          ...base,
          ...input,
          taskId: this.resolveTaskId(input.taskId),
        };
    }
  }

  private recompute(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): TaskStoreSnapshot {
    let view = new Map<TaskId, Task>(this.base);
    const pendingTaskIds = new Set<TaskId>();
    for (const command of this.queue.pending) {
      view = applyCommand(command, view);
      pendingTaskIds.add(commandTarget(command));
    }
    return {
      tasks: view,
      pendingCount: this.queue.pending.length,
      pendingTaskIds,
      deadLetters: this.queue.deadLetters,
      lastSyncTime: this.lastSyncTime,
    };
  }

  private async persistBase(): Promise<void> {
    await this.storage.setTasks([...this.base.values()]);
  }

  private async persistAliases(): Promise<void> {
    const record: Record<string, string> = {};
    for (const [from, to] of this.aliases) {
      record[String(from)] = String(to);
    }
    await this.storage.setIdAliases(JSON.stringify(record));
  }
}

function parseAliases(raw: string | null): Map<TaskId, TaskId> {
  if (!raw) return new Map();
  try {
    const result = AliasesSchema.safeParse(JSON.parse(raw));
    if (!result.success) return new Map();
    return new Map(
      Object.entries(result.data).map(([from, to]) => [
        taskId(from),
        taskId(to),
      ]),
    );
  } catch {
    return new Map();
  }
}
