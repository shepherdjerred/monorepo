import type { AppError } from "../../domain/errors";
import { ConnectionError } from "../../domain/errors";
import { type Result, OK_VOID, err } from "../../domain/result";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../../domain/types";
import type { TaskStatus } from "../../domain/status";
import type { TaskStore } from "../store/TaskStore";
import type { CommandQueue } from "./CommandQueue";
import { type Clock, type Command, classify } from "./commands";

/**
 * Single-flight queue drain.
 *
 * All sync triggers (dispatch, mount, reconnect, foreground, pull-to-refresh)
 * funnel into `requestSync()`; overlapping requests coalesce into one more
 * pass of the running loop instead of executing concurrently. That plus the
 * FIFO head-ack protocol is what guarantees each command is sent exactly once
 * per attempt — the old engine let every trigger replay the whole queue.
 *
 * Failure policy per command (see `classify`):
 * - transient (offline/5xx/429) → stop the drain, exponential backoff, retry
 * - auth (401/403)              → stop, surface auth status, wait for a new trigger
 * - not_found (404)             → deletes count as success; everything else
 *                                 dead-letters ("renamed/deleted in Obsidian")
 * - permanent (400/422/other)   → dead-letter, keep draining
 *
 * A successful drain ends with a full pull that replaces the store's base.
 */

export type MutationOptions = {
  mutationId?: string | undefined;
};

/** What the engine needs from the API client (TaskNotesClient satisfies it). */
export type CommandClient = {
  listTasks: () => Promise<Result<Task[], AppError>>;
  createTask: (
    req: CreateTaskRequest,
    options?: MutationOptions,
  ) => Promise<Result<Task, AppError>>;
  updateTask: (
    id: TaskId,
    req: UpdateTaskRequest,
    options?: MutationOptions,
  ) => Promise<Result<Task, AppError>>;
  deleteTask: (
    id: TaskId,
    options?: MutationOptions,
  ) => Promise<Result<void, AppError>>;
  toggleTaskStatus: (
    id: TaskId,
    status: TaskStatus,
    options?: MutationOptions,
  ) => Promise<Result<Task, AppError>>;
  completeRecurringInstance: (
    id: TaskId,
    instance?: { date: string; completed: boolean },
    options?: MutationOptions,
  ) => Promise<Result<Task, AppError>>;
};

export type SyncState =
  | "idle"
  | "syncing"
  | "backoff"
  | "auth_error"
  | "unconfigured";

export type SyncStatus = {
  readonly state: SyncState;
  readonly lastError: AppError | null;
  readonly nextRetryAt: number | null;
};

/** Schedule `fn` after `ms`; returns a cancel function. */
export type RetryScheduler = (fn: () => void, ms: number) => () => void;

const defaultScheduler: RetryScheduler = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => {
    clearTimeout(handle);
  };
};

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_JITTER = 0.2;

export type SyncEngineOptions = {
  clock?: Clock;
  scheduler?: RetryScheduler;
  /** Injectable for deterministic jitter in tests. */
  random?: () => number;
  onStatusChange?: (status: SyncStatus) => void;
};

export class SyncEngine {
  private readonly clock: Clock;
  private readonly scheduler: RetryScheduler;
  private readonly random: () => number;
  private readonly onStatusChange: ((status: SyncStatus) => void) | null;

  private status: SyncStatus = {
    state: "idle",
    lastError: null,
    nextRetryAt: null,
  };
  private inFlight: Promise<Result<void, AppError>> | null = null;
  private passRequested = false;
  private failureStreak = 0;
  private cancelRetry: (() => void) | null = null;

  constructor(
    private readonly client: CommandClient | null,
    private readonly queue: CommandQueue,
    private readonly store: TaskStore,
    options: SyncEngineOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.random = options.random ?? Math.random;
    this.onStatusChange = options.onStatusChange ?? null;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Fire-and-forget trigger; safe to call from anywhere, any number of times. */
  requestSync(): void {
    void this.syncNow();
  }

  /**
   * Trigger a sync and wait for the loop to settle (for pull-to-refresh).
   * If a sync is already running, this coalesces into one more pass and
   * resolves when the running loop finishes.
   */
  async syncNow(): Promise<Result<void, AppError>> {
    this.passRequested = true;
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.runLoop();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async runLoop(): Promise<Result<void, AppError>> {
    this.clearRetryTimer();
    let result: Result<void, AppError> = OK_VOID;
    while (this.passRequested) {
      this.passRequested = false;
      result = await this.syncOnce();
      if (!result.ok) break;
    }
    if (result.ok) {
      this.failureStreak = 0;
      this.setStatus({ state: "idle", lastError: null, nextRetryAt: null });
    }
    return result;
  }

  private async syncOnce(): Promise<Result<void, AppError>> {
    if (this.client === null) {
      const error = new ConnectionError("API URL not configured");
      this.setStatus({
        state: "unconfigured",
        lastError: error,
        nextRetryAt: null,
      });
      return err(error);
    }
    this.setStatus({ state: "syncing", lastError: null, nextRetryAt: null });

    const drained = await this.drain(this.client);
    if (!drained.ok) {
      this.handleStopError(drained.error);
      return drained;
    }

    const pulled = await this.client.listTasks();
    if (!pulled.ok) {
      this.handleStopError(pulled.error);
      return pulled;
    }
    await this.store.replaceBase(pulled.value, this.clock());
    return OK_VOID;
  }

  private async drain(client: CommandClient): Promise<Result<void, AppError>> {
    for (;;) {
      const command = this.queue.head();
      if (command === undefined) return OK_VOID;

      const result = await this.execute(client, command);
      if (result.ok) {
        await this.store.applyServerAck(command, result.value);
        continue;
      }

      switch (classify(result.error)) {
        case "transient":
          return err(result.error);
        case "auth":
          return err(result.error);
        case "not_found": {
          // A delete of an already-gone task reached its goal state; any
          // other 404 means the target was renamed/deleted in Obsidian.
          await (command.type === "delete"
            ? this.store.applyServerAck(command, null)
            : this.store.deadLetterCommand(command.id, result.error));
          continue;
        }
        case "permanent": {
          await this.store.deadLetterCommand(command.id, result.error);
          continue;
        }
      }
    }
  }

  private async execute(
    client: CommandClient,
    command: Command,
  ): Promise<Result<Task | null, AppError>> {
    const options: MutationOptions = { mutationId: command.id };
    switch (command.type) {
      case "create":
        return client.createTask(command.payload, options);
      case "update":
        return client.updateTask(command.taskId, command.payload, options);
      case "delete": {
        const result = await client.deleteTask(command.taskId, options);
        if (!result.ok) return result;
        return { ok: true, value: null };
      }
      case "set_status":
        return client.toggleTaskStatus(command.taskId, command.status, options);
      case "set_instance_complete":
        return client.completeRecurringInstance(
          command.taskId,
          { date: command.date, completed: command.completed },
          options,
        );
    }
  }

  private handleStopError(error: AppError): void {
    if (classify(error) === "auth") {
      this.setStatus({
        state: "auth_error",
        lastError: error,
        nextRetryAt: null,
      });
      return;
    }
    this.scheduleRetry(error);
  }

  private scheduleRetry(error: AppError): void {
    this.failureStreak += 1;
    const exponent = Math.min(this.failureStreak - 1, 30);
    const raw = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS);
    const jitter = 1 + (this.random() * 2 - 1) * BACKOFF_JITTER;
    const delay = Math.round(raw * jitter);
    const nextRetryAt = this.clock() + delay;
    this.setStatus({ state: "backoff", lastError: error, nextRetryAt });
    this.clearRetryTimer();
    this.cancelRetry = this.scheduler(() => {
      this.cancelRetry = null;
      this.requestSync();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.cancelRetry !== null) {
      this.cancelRetry();
      this.cancelRetry = null;
    }
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.onStatusChange?.(status);
  }
}
