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
import type { MutationStorage } from "../MutationQueue";
import { MutationQueue } from "../MutationQueue";
import type { SyncClient, TaskCacheStorage } from "../SyncEngine";
import { SyncEngine } from "../SyncEngine";

/**
 * Deterministic simulation harness for the sync layer.
 *
 * Everything time- or network-dependent is injected: a manual clock, an
 * in-memory fake server with offline/failure controls, and snapshot-able
 * storage fakes so tests can simulate an app crash/relaunch by rebuilding
 * the queue/engine from a storage snapshot.
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

export class MemoryMutationStorage implements MutationStorage {
  private value: string | null = null;

  read(): Promise<string | null> {
    return Promise.resolve(this.value);
  }

  write(data: string): Promise<void> {
    this.value = data;
    return Promise.resolve();
  }

  /** Capture durable state, e.g. right before a simulated crash. */
  snapshot(): string | null {
    return this.value;
  }

  static fromSnapshot(snapshot: string | null): MemoryMutationStorage {
    const storage = new MemoryMutationStorage();
    storage.value = snapshot;
    return storage;
  }
}

export class MemoryCache implements TaskCacheStorage {
  private tasks: Task[] = [];
  private lastSyncTime: number | null = null;

  getTasks(): Promise<Task[]> {
    return Promise.resolve(this.tasks);
  }

  setTasks(tasks: Task[]): Promise<void> {
    this.tasks = tasks;
    return Promise.resolve();
  }

  getLastSyncTime(): Promise<number | null> {
    return Promise.resolve(this.lastSyncTime);
  }

  setLastSyncTime(time: number): Promise<void> {
    this.lastSyncTime = time;
    return Promise.resolve();
  }

  snapshotTasks(): Task[] {
    return [...this.tasks];
  }
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
};

type FailNextRule = {
  method: MutationMethod;
  error: AppError;
};

/**
 * In-memory fake implementing the app's SyncClient contract faithfully
 * enough for sync-layer simulation:
 *
 * - IDs are vault-relative paths (matching the upstream path-as-ID scheme
 *   the server is moving to).
 * - `completeRecurringInstance` is a TOGGLE of "server-today" (the current
 *   production behavior, including its known flaws — the fake mirrors the
 *   contract as it exists so scenario tests describe reality).
 * - `goOffline()` makes every call fail with ConnectionError.
 * - `failNext(method, error)` injects a one-shot failure.
 * - `injectServerEdit(id, patch)` simulates a concurrent Obsidian edit.
 * - Every call is appended to `calls` for exactly-once assertions.
 */
export class FakeServer implements SyncClient {
  readonly tasks = new Map<TaskId, Task>();
  readonly calls: CallLogEntry[] = [];
  private offline = false;
  private readonly failNextRules: FailNextRule[] = [];
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

  private gate(
    method: MutationMethod,
    id: string | null,
    payload: unknown,
  ): AppError | null {
    this.calls.push({ method, id, payload });
    if (this.offline) {
      return new ConnectionError("FakeServer is offline");
    }
    const ruleIndex = this.failNextRules.findIndex((r) => r.method === method);
    if (ruleIndex !== -1) {
      const rule = this.failNextRules[ruleIndex];
      this.failNextRules.splice(ruleIndex, 1);
      if (rule !== undefined) {
        return rule.error;
      }
    }
    return null;
  }

  listTasks(): Promise<Result<Task[], AppError>> {
    const failure = this.gate("listTasks", null, null);
    if (failure) return Promise.resolve(err(failure));
    return Promise.resolve(ok([...this.tasks.values()].map((t) => ({ ...t }))));
  }

  createTask(req: CreateTaskRequest): Promise<Result<Task, AppError>> {
    const failure = this.gate("createTask", null, req);
    if (failure) return Promise.resolve(err(failure));
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
    return Promise.resolve(ok({ ...withRequest }));
  }

  updateTask(
    id: TaskId,
    req: UpdateTaskRequest,
  ): Promise<Result<Task, AppError>> {
    const failure = this.gate("updateTask", String(id), req);
    if (failure) return Promise.resolve(err(failure));
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      return Promise.resolve(err(new NotFoundError("Task", String(id))));
    }
    const updated = this.applyUpdates(existing, req);
    this.tasks.set(id, updated);
    return Promise.resolve(ok({ ...updated }));
  }

  deleteTask(id: TaskId): Promise<Result<void, AppError>> {
    const failure = this.gate("deleteTask", String(id), null);
    if (failure) return Promise.resolve(err(failure));
    if (!this.tasks.has(id)) {
      return Promise.resolve(err(new NotFoundError("Task", String(id))));
    }
    this.tasks.delete(id);
    return Promise.resolve(OK_VOID);
  }

  toggleTaskStatus(
    id: TaskId,
    status: TaskStatus,
  ): Promise<Result<Task, AppError>> {
    const failure = this.gate("toggleTaskStatus", String(id), { status });
    if (failure) return Promise.resolve(err(failure));
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      return Promise.resolve(err(new NotFoundError("Task", String(id))));
    }
    const updated = { ...existing, status };
    this.tasks.set(id, updated);
    return Promise.resolve(ok({ ...updated }));
  }

  completeRecurringInstance(id: TaskId): Promise<Result<Task, AppError>> {
    const failure = this.gate("completeRecurringInstance", String(id), null);
    if (failure) return Promise.resolve(err(failure));
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      return Promise.resolve(err(new NotFoundError("Task", String(id))));
    }
    const today = ymdOf(this.clock.now());
    const has = existing.completeInstances.includes(today);
    const updated: Task = {
      ...existing,
      completeInstances: has
        ? existing.completeInstances.filter((d) => d !== today)
        : [...existing.completeInstances, today],
    };
    this.tasks.set(id, updated);
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
  storage: MemoryMutationStorage;
  cache: MemoryCache;
  queue: MutationQueue;
  engine: SyncEngine;
  /** Latest task list delivered through the engine's onTasksUpdated callback. */
  tasksSeen: () => Task[];
};

/**
 * Wire a full sync stack over the fakes. Pass an existing storage snapshot
 * to simulate relaunching the app with persisted state.
 */
export function makeHarness(
  options: { storage?: MemoryMutationStorage; clock?: ManualClock } = {},
): Harness {
  const clock = options.clock ?? makeClock();
  const storage = options.storage ?? new MemoryMutationStorage();
  const server = new FakeServer(clock);
  const cache = new MemoryCache();
  const queue = new MutationQueue(storage, clock.now);
  let latest: Task[] = [];
  const engine = new SyncEngine(
    server,
    queue,
    (tasks) => {
      latest = tasks;
    },
    { cache, clock: clock.now },
  );
  return {
    clock,
    server,
    storage,
    cache,
    queue,
    engine,
    tasksSeen: () => latest,
  };
}
