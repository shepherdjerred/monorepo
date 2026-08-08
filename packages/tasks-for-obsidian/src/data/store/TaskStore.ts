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
import type { RecurringCompletionRestore } from "tasknotes-types/v2";
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
      readonly restore?: RecurringCompletionRestore | undefined;
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

function completionRestoreKey(id: TaskId, date: string): string {
  return `${String(id)}\u{0}${date}`;
}

export class TaskStore {
  private base = new Map<TaskId, Task>();
  private aliases = new Map<TaskId, TaskId>();
  private acknowledgedCompletionRestores = new Map<
    string,
    RecurringCompletionRestore
  >();
  private lastSyncTime: number | null = null;
  private snapshot: TaskStoreSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly nextCommandId: () => string;
  private operationLocked = false;
  private readonly operationWaiters: (() => void)[] = [];

  /** Wired to SyncEngine.requestSync — fired after every dispatch. */
  onDispatch: (() => void) | null = null;

  getPendingCompletionRestore(
    id: TaskId,
    date: string,
  ): Promise<RecurringCompletionRestore | undefined> {
    return this.enqueueOperation(() => {
      const target = this.resolveTaskId(id);
      let pendingRestore: RecurringCompletionRestore | undefined;
      for (const command of [...this.queue.pending].reverse()) {
        if (
          command.type === "set_instance_complete" &&
          command.taskId === target &&
          command.date === date &&
          command.completed &&
          command.restore !== undefined
        ) {
          pendingRestore = command.restore;
          break;
        }
      }
      if (pendingRestore !== undefined) {
        return Promise.resolve(pendingRestore);
      }
      return Promise.resolve(
        this.acknowledgedCompletionRestores.get(
          completionRestoreKey(target, date),
        ),
      );
    });
  }

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
    await this.enqueueOperation(async () => {
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
    });
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
    return this.enqueueOperation(async () => {
      // Build inside the serialized operation so a stale temp id is resolved
      // only after any in-flight create acknowledgement has committed its
      // alias and snapshot together.
      const command = this.buildCommand(input);
      await this.queue.enqueue(command);
      if (
        command.type === "set_instance_complete" &&
        !command.completed &&
        command.restore !== undefined
      ) {
        this.acknowledgedCompletionRestores.delete(
          completionRestoreKey(command.taskId, command.date),
        );
      }
      this.recompute();
      this.onDispatch?.();
      const target =
        command.type === "create" ? command.tempId : command.taskId;
      return this.snapshot.tasks.get(target);
    });
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
    await this.enqueueOperation(async () => {
      let nextAliases = this.aliases;
      let nextAcknowledgedCompletionRestores =
        this.acknowledgedCompletionRestores;
      if (serverTask !== null && command.type === "create") {
        nextAliases = new Map(this.aliases);
        nextAliases.set(command.tempId, serverTask.id);
        await this.queue.remapTaskId(command.tempId, serverTask.id);
        await this.persistAliases(nextAliases);
      }

      const nextBase = new Map(this.base);
      if (command.type === "delete") {
        nextBase.delete(command.taskId);
      } else if (serverTask !== null) {
        nextBase.set(serverTask.id, serverTask);
      }
      if (
        command.type === "set_instance_complete" &&
        command.completed &&
        command.restore !== undefined
      ) {
        nextAcknowledgedCompletionRestores = new Map(
          this.acknowledgedCompletionRestores,
        );
        nextAcknowledgedCompletionRestores.set(
          completionRestoreKey(command.taskId, command.date),
          command.restore,
        );
      }
      // Persist the authoritative base before removing the durable command.
      // If the process dies between these writes, idempotent mutation replay
      // is safe; the reverse order could lose the accepted mutation offline.
      await this.persistBase(nextBase);
      await this.queue.ack(command.id);

      // Publish the alias/base/snapshot as one synchronous state transition.
      // Readers can therefore never observe a real-id alias paired with the
      // preceding temp-id snapshot while persistence is in flight.
      this.aliases = nextAliases;
      this.base = nextBase;
      this.acknowledgedCompletionRestores = nextAcknowledgedCompletionRestores;
      this.recompute();
    });
  }

  /** A command failed permanently — park it and roll back its optimistic effect. */
  async deadLetterCommand(
    ...args: Parameters<CommandQueue["deadLetter"]>
  ): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.queue.deadLetter(...args);
      this.recompute();
    });
  }

  async retryDeadLetter(id: string): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.queue.retryDeadLetter(id);
      this.recompute();
      this.onDispatch?.();
    });
  }

  async discardDeadLetter(id: string): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.queue.discardDeadLetter(id);
      this.recompute();
    });
  }

  /** Replace the base with a fresh full pull and prune stale aliases. */
  async replaceBase(tasks: Task[], syncedAt: number): Promise<void> {
    await this.enqueueOperation(async () => {
      const nextBase = new Map(tasks.map((t) => [t.id, t]));
      const nextAliases = new Map(this.aliases);
      for (const [tempId, realId] of nextAliases) {
        if (!nextBase.has(realId)) nextAliases.delete(tempId);
      }
      await this.persistBase(nextBase);
      await this.persistAliases(nextAliases);
      await this.storage.setLastSyncTime(syncedAt);

      this.base = nextBase;
      this.aliases = nextAliases;
      this.lastSyncTime = syncedAt;
      this.recompute();
    });
  }

  private buildCommand(input: DispatchInput): Command {
    const base = { id: this.nextCommandId(), createdAt: this.clock() };
    switch (input.type) {
      case "create":
        return { ...base, ...input, tempId: makeTempId(this.clock) };
      case "update":
      case "delete":
      case "set_status":
        return {
          ...base,
          ...input,
          taskId: this.resolveTaskId(input.taskId),
        };
      case "set_instance_complete": {
        const resolvedTaskId = this.resolveTaskId(input.taskId);
        if (input.completed) {
          return {
            ...base,
            type: input.type,
            taskId: resolvedTaskId,
            date: input.date,
            completed: true,
            ...(input.restore === undefined ? {} : { restore: input.restore }),
          };
        }
        return {
          ...base,
          type: input.type,
          taskId: resolvedTaskId,
          date: input.date,
          completed: false,
          ...(input.restore === undefined ? {} : { restore: input.restore }),
        };
      }
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

  private async persistBase(base: ReadonlyMap<TaskId, Task>): Promise<void> {
    await this.storage.setTasks([...base.values()]);
  }

  private async persistAliases(
    aliases: ReadonlyMap<TaskId, TaskId>,
  ): Promise<void> {
    const record: Record<string, string> = {};
    for (const [from, to] of aliases) {
      record[String(from)] = String(to);
    }
    await this.storage.setIdAliases(JSON.stringify(record));
  }

  private async enqueueOperation<Value>(
    operation: () => Promise<Value>,
  ): Promise<Value> {
    await this.acquireOperationLock();
    try {
      return await operation();
    } finally {
      this.releaseOperationLock();
    }
  }

  private async acquireOperationLock(): Promise<void> {
    if (!this.operationLocked) {
      this.operationLocked = true;
      return;
    }
    await new Promise<void>((resolve) => {
      this.operationWaiters.push(resolve);
    });
  }

  private releaseOperationLock(): void {
    const next = this.operationWaiters.shift();
    if (next === undefined) {
      this.operationLocked = false;
      return;
    }
    next();
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
