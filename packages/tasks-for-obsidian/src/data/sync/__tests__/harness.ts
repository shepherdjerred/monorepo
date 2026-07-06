import type { Result } from "../../../domain/result";
import { OK_VOID, ok, err } from "../../../domain/result";
import type { AppError } from "../../../domain/errors";
import { ConnectionError, NotFoundError } from "../../../domain/errors";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../../../domain/types";
import { taskId } from "../../../domain/types";
import type { TaskStatus } from "../../../domain/status";
import { CommandQueue, type CommandQueueStorage } from "../CommandQueue";
import type { CommandClient, MutationOptions, SyncStatus } from "../SyncEngine";
import { SyncEngine } from "../SyncEngine";
import { TaskStore, type TaskStoreStorage } from "../../store/TaskStore";

/**
 * Deterministic simulation harness for the offline-first sync stack.
 *
 * Everything time- or network-dependent is injected: a manual clock, a
 * manual retry scheduler, and an in-memory fake server with offline/failure
 * controls plus an idempotency store mirroring the real server's
 * `X-Mutation-Id` dedup. Storage fakes are snapshot-able so tests can
 * simulate a crash/relaunch by rebuilding the whole stack from durable
 * state only.
 */

export type ManualClock = {
  now: () => number;
  advance: (ms: number) => void;
  set: (ms: number) => void;
};

export function makeClock(startMs = 1_750_000_000_000): ManualClock {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    set: (ms) => {
      current = ms;
    },
  };
}

function ymdOf(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}-${month}-${day}`;
}

export type MemoryQueueStorage = CommandQueueStorage & {
  clone: () => MemoryQueueStorage;
};

export function memoryQueueStorage(
  initial: { queue?: string | null; dead?: string | null } = {},
): MemoryQueueStorage {
  let queue = initial.queue ?? null;
  let dead = initial.dead ?? null;
  return {
    readQueue: () => Promise.resolve(queue),
    writeQueue: (d) => {
      queue = d;
      return Promise.resolve();
    },
    readDeadLetter: () => Promise.resolve(dead),
    writeDeadLetter: (d) => {
      dead = d;
      return Promise.resolve();
    },
    clone: () => memoryQueueStorage({ queue, dead }),
  };
}

export type MemoryStoreStorage = TaskStoreStorage & {
  clone: () => MemoryStoreStorage;
};

export function memoryStoreStorage(
  initial: {
    tasks?: Task[];
    aliases?: string | null;
    lastSync?: number | null;
  } = {},
): MemoryStoreStorage {
  let tasks = initial.tasks ?? [];
  let aliases = initial.aliases ?? null;
  let lastSync = initial.lastSync ?? null;
  return {
    getTasks: () => Promise.resolve(tasks),
    setTasks: (t) => {
      tasks = t;
      return Promise.resolve();
    },
    getIdAliases: () => Promise.resolve(aliases),
    setIdAliases: (d) => {
      aliases = d;
      return Promise.resolve();
    },
    getLastSyncTime: () => Promise.resolve(lastSync),
    setLastSyncTime: (t) => {
      lastSync = t;
      return Promise.resolve();
    },
    clone: () => memoryStoreStorage({ tasks, aliases, lastSync }),
  };
}

/** Captures retry timers so tests decide when (whether) they fire. */
export type ManualScheduler = {
  schedule: (fn: () => void, ms: number) => () => void;
  /** Timers scheduled and not yet fired or cancelled. */
  pending: () => { fn: () => void; ms: number }[];
  /** Fire the oldest pending timer. Throws if none. */
  fireNext: () => void;
};

export function makeScheduler(): ManualScheduler {
  type Entry = {
    fn: () => void;
    ms: number;
    cancelled: boolean;
    fired: boolean;
  };
  const entries: Entry[] = [];
  return {
    schedule: (fn, ms) => {
      const entry: Entry = { fn, ms, cancelled: false, fired: false };
      entries.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    pending: () =>
      entries
        .filter((e) => !e.cancelled && !e.fired)
        .map(({ fn, ms }) => ({ fn, ms })),
    fireNext: () => {
      const entry = entries.find((e) => !e.cancelled && !e.fired);
      if (entry === undefined) throw new Error("no pending timer");
      entry.fired = true;
      entry.fn();
    },
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const base: Task = {
    id: taskId("TaskNotes/test.md"),
    path: "TaskNotes/test.md",
    title: "Test",
    status: "open",
    priority: "normal",
    contexts: [],
    projects: [],
    tags: [],
    completeInstances: [],
    skippedInstances: [],
    timeEntries: [],
    blockedBy: [],
    reminders: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    extraFields: {},
  };
  return { ...base, ...overrides };
}

export type MutationMethod =
  | "createTask"
  | "updateTask"
  | "deleteTask"
  | "toggleTaskStatus"
  | "completeRecurringInstance"
  | "listTasks";

export type CallLogEntry = {
  method: MutationMethod;
  id: string | null;
  payload: unknown;
  mutationId: string | null;
  /** True when the idempotency store answered without re-applying. */
  replayed: boolean;
  /** True when the call actually mutated server state. */
  applied: boolean;
};

type FailNextRule = {
  method: MutationMethod;
  error: AppError;
};

type StoredResponse = { kind: "task"; task: Task } | { kind: "void" };

/**
 * In-memory fake implementing the engine's CommandClient contract:
 *
 * - IDs are vault-relative paths (matching the upstream path-as-ID scheme).
 * - Mutations carrying an `X-Mutation-Id` are deduped exactly like the real
 *   server's idempotency middleware: a replayed id returns the stored
 *   response without re-applying (crash-replay safety).
 * - `completeRecurringInstance` with a body applies absolute set-semantics
 *   (the P1 contract); without one it falls back to toggle-server-today.
 * - `goOffline()` makes every call fail with ConnectionError.
 * - `failNext(method, error)` injects a one-shot failure.
 * - `injectServerEdit(id, patch)` simulates a concurrent Obsidian edit.
 * - Every wire call is appended to `calls` for exactly-once assertions.
 */
export class FakeServer implements CommandClient {
  readonly tasks = new Map<TaskId, Task>();
  readonly calls: CallLogEntry[] = [];
  private offline = false;
  private readonly failNextRules: FailNextRule[] = [];
  private readonly idempotency = new Map<string, StoredResponse>();
  private createCounter = 0;

  constructor(private readonly clock: ManualClock) {}

  seed(...tasks: Task[]): void {
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }

  goOffline(): void {
    this.offline = true;
  }

  goOnline(): void {
    this.offline = false;
  }

  failNext(method: MutationMethod, error: AppError): void {
    this.failNextRules.push({ method, error });
  }

  injectServerEdit(id: TaskId, patch: Partial<Task>): void {
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      throw new Error(`injectServerEdit: unknown task ${String(id)}`);
    }
    this.tasks.set(id, { ...existing, ...patch });
  }

  callCount(method: MutationMethod): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  /** Calls that actually mutated state (failures and idempotent replays excluded). */
  applyCount(method: MutationMethod): number {
    return this.calls.filter((c) => c.method === method && c.applied).length;
  }

  /**
   * Gate every wire call: log it, then fail if offline / a one-shot rule
   * matches, then answer from the idempotency store on a replayed id.
   * Returns `{ replay }` when the dedup store already holds a response.
   */
  private gate(
    method: MutationMethod,
    id: string | null,
    payload: unknown,
    mutationId: string | null,
  ): { error: AppError } | { replay: StoredResponse } | null {
    const entry: CallLogEntry = {
      method,
      id,
      payload,
      mutationId,
      replayed: false,
      applied: false,
    };
    this.calls.push(entry);
    if (this.offline) {
      return { error: new ConnectionError("FakeServer is offline") };
    }
    const ruleIndex = this.failNextRules.findIndex((r) => r.method === method);
    if (ruleIndex !== -1) {
      const rule = this.failNextRules[ruleIndex];
      this.failNextRules.splice(ruleIndex, 1);
      if (rule !== undefined) {
        return { error: rule.error };
      }
    }
    if (mutationId !== null) {
      const stored = this.idempotency.get(mutationId);
      if (stored !== undefined) {
        entry.replayed = true;
        return { replay: stored };
      }
    }
    return null;
  }

  /** Mark the in-flight call as applied and store its response for dedup. */
  private remember(mutationId: string | null, response: StoredResponse): void {
    const last = this.calls.at(-1);
    if (last !== undefined) last.applied = true;
    if (mutationId !== null) {
      this.idempotency.set(mutationId, response);
    }
  }

  listTasks(): Promise<Result<Task[], AppError>> {
    const gate = this.gate("listTasks", null, null, null);
    if (gate !== null && "error" in gate)
      return Promise.resolve(err(gate.error));
    return Promise.resolve(ok([...this.tasks.values()].map((t) => ({ ...t }))));
  }

  createTask(
    req: CreateTaskRequest,
    options?: MutationOptions,
  ): Promise<Result<Task, AppError>> {
    const mutationId = options?.mutationId ?? null;
    const gate = this.gate("createTask", null, req, mutationId);
    if (gate !== null) {
      if ("error" in gate) return Promise.resolve(err(gate.error));
      if (gate.replay.kind === "task") {
        return Promise.resolve(ok({ ...gate.replay.task }));
      }
      throw new Error("createTask idempotency store held a void response");
    }
    this.createCounter += 1;
    const path = `TaskNotes/${req.title}-${String(this.createCounter)}.md`;
    const task = makeTask({
      id: taskId(path),
      path,
      title: req.title,
      dateCreated: new Date(this.clock.now()).toISOString(),
      dateModified: new Date(this.clock.now()).toISOString(),
    });
    const withRequest = this.applyUpdates(task, req);
    this.tasks.set(withRequest.id, withRequest);
    this.remember(mutationId, { kind: "task", task: withRequest });
    return Promise.resolve(ok({ ...withRequest }));
  }

  updateTask(
    id: TaskId,
    req: UpdateTaskRequest,
    options?: MutationOptions,
  ): Promise<Result<Task, AppError>> {
    const mutationId = options?.mutationId ?? null;
    const gate = this.gate("updateTask", String(id), req, mutationId);
    if (gate !== null) {
      if ("error" in gate) return Promise.resolve(err(gate.error));
      if (gate.replay.kind === "task") {
        return Promise.resolve(ok({ ...gate.replay.task }));
      }
      throw new Error("updateTask idempotency store held a void response");
    }
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      return Promise.resolve(err(new NotFoundError("Task", String(id))));
    }
    const updated = this.applyUpdates(existing, req);
    this.tasks.set(id, updated);
    this.remember(mutationId, { kind: "task", task: updated });
    return Promise.resolve(ok({ ...updated }));
  }

  deleteTask(
    id: TaskId,
    options?: MutationOptions,
  ): Promise<Result<void, AppError>> {
    const mutationId = options?.mutationId ?? null;
    const gate = this.gate("deleteTask", String(id), null, mutationId);
    if (gate !== null) {
      if ("error" in gate) return Promise.resolve(err(gate.error));
      return Promise.resolve(OK_VOID);
    }
    if (!this.tasks.has(id)) {
      return Promise.resolve(err(new NotFoundError("Task", String(id))));
    }
    this.tasks.delete(id);
    this.remember(mutationId, { kind: "void" });
    return Promise.resolve(OK_VOID);
  }

  toggleTaskStatus(
    id: TaskId,
    status: TaskStatus,
    options?: MutationOptions,
  ): Promise<Result<Task, AppError>> {
    const mutationId = options?.mutationId ?? null;
    const gate = this.gate(
      "toggleTaskStatus",
      String(id),
      { status },
      mutationId,
    );
    if (gate !== null) {
      if ("error" in gate) return Promise.resolve(err(gate.error));
      if (gate.replay.kind === "task") {
        return Promise.resolve(ok({ ...gate.replay.task }));
      }
      throw new Error(
        "toggleTaskStatus idempotency store held a void response",
      );
    }
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      return Promise.resolve(err(new NotFoundError("Task", String(id))));
    }
    const updated = { ...existing, status };
    this.tasks.set(id, updated);
    this.remember(mutationId, { kind: "task", task: updated });
    return Promise.resolve(ok({ ...updated }));
  }

  completeRecurringInstance(
    id: TaskId,
    instance?: { date: string; completed: boolean },
    options?: MutationOptions,
  ): Promise<Result<Task, AppError>> {
    const mutationId = options?.mutationId ?? null;
    const gate = this.gate(
      "completeRecurringInstance",
      String(id),
      instance ?? null,
      mutationId,
    );
    if (gate !== null) {
      if ("error" in gate) return Promise.resolve(err(gate.error));
      if (gate.replay.kind === "task") {
        return Promise.resolve(ok({ ...gate.replay.task }));
      }
      throw new Error(
        "completeRecurringInstance idempotency store held a void response",
      );
    }
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      return Promise.resolve(err(new NotFoundError("Task", String(id))));
    }
    let completeInstances: string[];
    if (instance === undefined) {
      // Legacy fallback: toggle "server today".
      const today = ymdOf(this.clock.now());
      const has = existing.completeInstances.includes(today);
      completeInstances = has
        ? existing.completeInstances.filter((d) => d !== today)
        : [...existing.completeInstances, today];
    } else {
      // P1 set-semantics: absolute state at the app-provided date.
      const has = existing.completeInstances.includes(instance.date);
      if (instance.completed === has) {
        completeInstances = [...existing.completeInstances];
      } else if (instance.completed) {
        completeInstances = [...existing.completeInstances, instance.date];
      } else {
        completeInstances = existing.completeInstances.filter(
          (d) => d !== instance.date,
        );
      }
    }
    const updated: Task = { ...existing, completeInstances };
    this.tasks.set(id, updated);
    this.remember(mutationId, { kind: "task", task: updated });
    return Promise.resolve(ok({ ...updated }));
  }

  private applyUpdates(
    task: Task,
    req: CreateTaskRequest | UpdateTaskRequest,
  ): Task {
    const updates: Partial<Task> = {};
    for (const [key, value] of Object.entries(req)) {
      if (value !== undefined) {
        Object.assign(updates, { [key]: value });
      }
    }
    return { ...task, ...updates };
  }
}

export type Harness = {
  clock: ManualClock;
  server: FakeServer;
  queueStorage: MemoryQueueStorage;
  storeStorage: MemoryStoreStorage;
  scheduler: ManualScheduler;
  queue: CommandQueue;
  store: TaskStore;
  engine: SyncEngine;
  statusLog: SyncStatus[];
};

/**
 * Wire a full offline-first stack over the fakes. Pass existing storages
 * (and/or the previous FakeServer) to simulate relaunching the app with
 * persisted client state against a server that remembers what it applied.
 * `restore()` is left to the caller so pre-restore states are testable.
 */
export function makeHarness(
  options: {
    clock?: ManualClock;
    server?: FakeServer;
    queueStorage?: MemoryQueueStorage;
    storeStorage?: MemoryStoreStorage;
    /** Wire dispatch → requestSync like the real app (default: manual sync). */
    autoSync?: boolean;
  } = {},
): Harness {
  const clock = options.clock ?? makeClock();
  const server = options.server ?? new FakeServer(clock);
  const queueStorage = options.queueStorage ?? memoryQueueStorage();
  const storeStorage = options.storeStorage ?? memoryStoreStorage();
  const scheduler = makeScheduler();
  const queue = new CommandQueue(queueStorage, clock.now);
  const store = new TaskStore(queue, storeStorage, clock.now);
  const statusLog: SyncStatus[] = [];
  const engine = new SyncEngine(server, queue, store, {
    clock: clock.now,
    scheduler: scheduler.schedule,
    random: () => 0.5, // deterministic: jitter factor 1.0
    onStatusChange: (status) => {
      statusLog.push(status);
    },
  });
  if (options.autoSync === true) {
    store.onDispatch = () => {
      engine.requestSync();
    };
  }
  return {
    clock,
    server,
    queueStorage,
    storeStorage,
    scheduler,
    queue,
    store,
    engine,
    statusLog,
  };
}
