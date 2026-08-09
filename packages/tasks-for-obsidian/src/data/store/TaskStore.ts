import { z } from "zod";

import { TypedStorage } from "../cache/storage";
import type { Task, TaskId } from "../../domain/types";
import { taskId } from "../../domain/types";
import type { RecurringCompletionRestore } from "tasknotes-types/v2";
import type { CommandQueue, DeadLetterEntry } from "../sync/CommandQueue";
import {
  type Clock,
  type Command,
  type CommandInput,
  applyCommand,
  commandId,
  commandTarget,
  tempTaskId,
} from "../sync/commands";
import { localTodayYmd } from "../../domain/recurrence";
import {
  type StoredCompletionRestore,
  completionRestoreKey,
  invalidateChangedCompletionRestores,
  invalidateCompletionRestores,
  isOccurrenceEdit,
  isTaskOccurrenceEdit,
  parseAcknowledgedCompletionRestores,
  pruneCompletionRestores,
  serializeAcknowledgedCompletionRestores,
  taskAfterCommands,
} from "./acknowledged-completion-restores";

/**
 * The single source of truth the UI reads.
 *
 * The visible map is `rebase(base, queue.pending)`, recomputed on every
 * change. Only the command queue and server base are durable, so a crash
 * cannot capture a half-applied optimistic state. The store never touches
 * the network; SyncEngine reports results through acknowledgements or pulls.
 */

export type TaskStoreSnapshot = {
  readonly tasks: ReadonlyMap<TaskId, Task>;
  readonly pendingCount: number;
  /** Tasks with at least one unsynced pending command (quiet trust signal). */
  readonly pendingTaskIds: ReadonlySet<TaskId>;
  readonly deadLetters: readonly DeadLetterEntry[];
  readonly lastSyncTime: number | null;
};

export type TaskStoreStorage = {
  getTasks: () => Promise<Task[]>;
  setTasks: (tasks: Task[]) => Promise<void>;
  getIdAliases: () => Promise<string | null>;
  setIdAliases: (data: string) => Promise<void>;
  getAcknowledgedCompletionRestores: () => Promise<string | null>;
  setAcknowledgedCompletionRestores: (data: string) => Promise<void>;
  getIdCounters: () => Promise<string | null>;
  setIdCounters: (data: string) => Promise<void>;
  getLastSyncTime: () => Promise<number | null>;
  setLastSyncTime: (time: number) => Promise<void>;
};

const defaultStorage: TaskStoreStorage = {
  getTasks: () => TypedStorage.getTasks(),
  setTasks: (tasks) => TypedStorage.setTasks(tasks),
  getIdAliases: () => TypedStorage.getIdAliases(),
  setIdAliases: (data) => TypedStorage.setIdAliases(data),
  getAcknowledgedCompletionRestores: () =>
    TypedStorage.getAcknowledgedCompletionRestores(),
  setAcknowledgedCompletionRestores: (data) =>
    TypedStorage.setAcknowledgedCompletionRestores(data),
  getIdCounters: () => TypedStorage.getIdCounters(),
  setIdCounters: (data) => TypedStorage.setIdCounters(data),
  getLastSyncTime: () => TypedStorage.getLastSyncTime(),
  setLastSyncTime: (time) => TypedStorage.setLastSyncTime(time),
};

const AliasesSchema = z.record(z.string(), z.string());

const IdCountersSchema = z.object({
  command: z.number().int().nonnegative(),
  temp: z.number().int().nonnegative(),
});

type IdCounters = z.infer<typeof IdCountersSchema>;

const ZERO_COUNTERS: IdCounters = { command: 0, temp: 0 };

export class TaskStore {
  private base = new Map<TaskId, Task>();
  private aliases = new Map<TaskId, TaskId>();
  private acknowledgedCompletionRestores = new Map<
    string,
    StoredCompletionRestore
  >();
  private lastSyncTime: number | null = null;
  private snapshot: TaskStoreSnapshot;
  private readonly listeners = new Set<() => void>();
  private operationLocked = false;
  private readonly operationWaiters: (() => void)[] = [];
  private counters: IdCounters = ZERO_COUNTERS;

  /** Wired to SyncEngine.requestSync — fired after every dispatch. */
  onDispatch: (() => void) | null = null;
  getPendingCompletionRestore(
    id: TaskId,
    date: string,
  ): Promise<RecurringCompletionRestore | undefined> {
    return this.enqueueOperation(async () => {
      const target = this.resolveTaskId(id);
      const pending = this.queue.pending;
      let pendingRestore: RecurringCompletionRestore | undefined;
      let completionIndex = -1;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const command = pending[index];
        if (command === undefined) continue;
        if (
          command.type === "set_instance_complete" &&
          command.taskId === target &&
          command.date === date &&
          command.completed &&
          command.restore !== undefined
        ) {
          pendingRestore = command.restore;
          completionIndex = index;
          break;
        }
      }
      if (pendingRestore !== undefined) {
        const taskAtCompletion = taskAfterCommands(
          this.base,
          pending,
          completionIndex,
          target,
        );
        if (
          pending
            .slice(completionIndex + 1)
            .some((command) =>
              isTaskOccurrenceEdit(command, target, taskAtCompletion),
            )
        ) {
          return;
        }
        return pendingRestore;
      }
      if (
        pending.some((command) =>
          isTaskOccurrenceEdit(command, target, this.base.get(target)),
        )
      ) {
        return;
      }
      const key = completionRestoreKey(target, date);
      const stored = this.acknowledgedCompletionRestores.get(key);
      if (
        stored === undefined ||
        date < localTodayYmd(new Date(this.clock()))
      ) {
        if (stored !== undefined) {
          const next = new Map(this.acknowledgedCompletionRestores);
          next.delete(key);
          await this.storage.setAcknowledgedCompletionRestores(
            serializeAcknowledgedCompletionRestores(next),
          );
          this.acknowledgedCompletionRestores = next;
        }
        return;
      }
      return stored.restore;
    });
  }
  constructor(
    private readonly queue: CommandQueue,
    private readonly storage: TaskStoreStorage = defaultStorage,
    private readonly clock: Clock = Date.now,
    /** Injectable so the id encoding is reproducible in the simulation harness. */
    private readonly random: () => number = Math.random,
  ) {
    this.snapshot = this.buildSnapshot();
  }

  /**
   * Load queue + cached base + aliases + id counters. Call once at startup,
   * after migrations.
   */
  async restore(): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.queue.restore();
      const [tasks, rawAliases, rawAcknowledgedRestores, rawCounters, lastSync] =
        await Promise.all([
          this.storage.getTasks(),
          this.storage.getIdAliases(),
          this.storage.getAcknowledgedCompletionRestores(),
          this.storage.getIdCounters(),
          this.storage.getLastSyncTime(),
        ]);
      this.base = new Map(tasks.map((t) => [t.id, t]));
      this.aliases = parseAliases(rawAliases);
      const nextAcknowledgedCompletionRestores = pruneCompletionRestores(
        parseAcknowledgedCompletionRestores(rawAcknowledgedRestores),
        localTodayYmd(new Date(this.clock())),
        this.base,
      );
      await this.storage.setAcknowledgedCompletionRestores(
        serializeAcknowledgedCompletionRestores(
          nextAcknowledgedCompletionRestores,
        ),
      );
      this.acknowledgedCompletionRestores = nextAcknowledgedCompletionRestores;
      this.counters = parseIdCounters(rawCounters);
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
  /** Record a mutation and return its immediate optimistic result. */
  async dispatch(input: CommandInput) {
    return this.dispatchLocked(input, false);
  }
  async dispatchIfTaskExists(
    input: Exclude<CommandInput, { readonly type: "create" }>,
  ) {
    return this.dispatchLocked(input, true);
  }
  private async dispatchLocked(
    input: CommandInput,
    requireExistingTask: boolean,
  ) {
    return this.enqueueOperation(async () => {
      // Resolve aliases and validate existence within the durable queue lock.
      if (requireExistingTask && input.type !== "create") {
        const target = this.resolveTaskId(input.taskId);
        if (!this.snapshot.tasks.has(target)) return;
      }
      const command = this.buildCommand(input);
      // Counters first, queue second, and never the other way round: the id has
      // to be durably spent before the command carrying it can reach the wire.
      // Crashing after this write only burns id values, which is free; crashing
      // between the enqueue and this write would hand the id back out.
      await this.persistIdCounters();
      await this.queue.enqueue(command);
      let nextAcknowledgedCompletionRestores =
        this.acknowledgedCompletionRestores;
      if (
        command.type === "set_instance_complete" &&
        !command.completed &&
        command.restore !== undefined
      ) {
        nextAcknowledgedCompletionRestores = new Map(
          nextAcknowledgedCompletionRestores,
        );
        nextAcknowledgedCompletionRestores.delete(
          completionRestoreKey(command.taskId, command.date),
        );
      }
      if (
        nextAcknowledgedCompletionRestores !==
        this.acknowledgedCompletionRestores
      ) {
        await this.storage.setAcknowledgedCompletionRestores(
          serializeAcknowledgedCompletionRestores(
            nextAcknowledgedCompletionRestores,
          ),
        );
        this.acknowledgedCompletionRestores =
          nextAcknowledgedCompletionRestores;
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
      nextAcknowledgedCompletionRestores = pruneCompletionRestores(
        nextAcknowledgedCompletionRestores,
        localTodayYmd(new Date(this.clock())),
        nextBase,
      );
      if (
        command.type === "update" &&
        isOccurrenceEdit(command, this.base.get(command.taskId))
      ) {
        nextAcknowledgedCompletionRestores = invalidateCompletionRestores(
          nextAcknowledgedCompletionRestores,
          command.taskId,
        );
      }
      if (
        command.type === "set_instance_complete" &&
        command.completed &&
        command.restore !== undefined
      ) {
        nextAcknowledgedCompletionRestores = new Map(
          nextAcknowledgedCompletionRestores,
        );
        nextAcknowledgedCompletionRestores.set(
          completionRestoreKey(command.taskId, command.date),
          { restore: command.restore },
        );
      }
      // Persist the authoritative base before removing the durable command.
      // If the process dies between these writes, idempotent mutation replay
      // is safe; the reverse order could lose the accepted mutation offline.
      await this.persistBase(nextBase);
      await this.storage.setAcknowledgedCompletionRestores(
        serializeAcknowledgedCompletionRestores(
          nextAcknowledgedCompletionRestores,
        ),
      );
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
      const prunedAcknowledgedCompletionRestores = pruneCompletionRestores(
        this.acknowledgedCompletionRestores,
        localTodayYmd(new Date(this.clock())),
        nextBase,
      );
      const nextAcknowledgedCompletionRestores =
        invalidateChangedCompletionRestores(
          prunedAcknowledgedCompletionRestores,
          this.base,
          nextBase,
        );
      await this.storage.setAcknowledgedCompletionRestores(
        serializeAcknowledgedCompletionRestores(
          nextAcknowledgedCompletionRestores,
        ),
      );
      await this.persistBase(nextBase);
      await this.persistAliases(nextAliases);
      await this.storage.setLastSyncTime(syncedAt);

      this.base = nextBase;
      this.aliases = nextAliases;
      this.acknowledgedCompletionRestores = nextAcknowledgedCompletionRestores;
      this.lastSyncTime = syncedAt;
      this.recompute();
    });
  }

  /**
   * The only place in the stack a command id or a temp id is minted, so the
   * two counters cannot drift out of step with what gets persisted.
   */
  private buildCommand(input: CommandInput): Command {
    const createdAt = this.clock();
    const base = { id: this.nextCommandId(createdAt), createdAt };
    switch (input.type) {
      case "create":
        return { ...base, ...input, tempId: this.nextTempId(createdAt) };
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

  /**
   * Mint a command id no durable command already carries.
   *
   * The persisted counter is what actually removes the collision class — it
   * never restarts, so the same `(millis, counter)` pair is never offered
   * twice. The check is the backstop for the two states the counter cannot
   * describe: the first launch after upgrading from a build that did not
   * persist it (counter 0, queue non-empty), and a counter blob that failed to
   * parse. Without one of the two, an app killed and reopened inside a single
   * clock millisecond re-mints a live `X-Mutation-Id`, and the server answers
   * the second command from the first one's stored response — silent data
   * loss, found by generated-sequence testing in the Rust port.
   *
   * The loop terminates: the counter strictly increases, and no id in the
   * finite durable set encodes a counter above every value already seen.
   */
  private nextCommandId(createdAt: number): string {
    for (;;) {
      this.counters = { ...this.counters, command: this.counters.command + 1 };
      const candidate = commandId(
        createdAt,
        this.counters.command,
        this.random(),
      );
      if (!this.queue.hasCommandId(candidate)) return candidate;
    }
  }

  /** Mint a temp id neither the cached base nor any durable command claims. */
  private nextTempId(createdAt: number): TaskId {
    for (;;) {
      this.counters = { ...this.counters, temp: this.counters.temp + 1 };
      const candidate = tempTaskId(createdAt, this.counters.temp);
      if (!this.base.has(candidate) && !this.queue.hasTarget(candidate)) {
        return candidate;
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

  private async persistIdCounters(): Promise<void> {
    await this.storage.setIdCounters(JSON.stringify(this.counters));
  }
}

/**
 * Absent or unreadable counters mean "start at zero" — a fresh install, and
 * also every install that predates the key. Neither needs a schema migration:
 * `nextCommandId` / `nextTempId` refuse to hand back an id the restored queue
 * already holds, so a carried-over queue is safe on that first launch too.
 */
function parseIdCounters(raw: string | null): IdCounters {
  if (!raw) return ZERO_COUNTERS;
  try {
    const parsed = IdCountersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : ZERO_COUNTERS;
  } catch {
    return ZERO_COUNTERS;
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
