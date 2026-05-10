import { TypedStorage } from "../cache/storage";
import type { MutationClient, MutationQueue, Mutation } from "./MutationQueue";
import type { AppError } from "../../domain/errors";
import { type Result, OK_VOID, err } from "../../domain/result";
import { ConnectionError } from "../../domain/errors";
import type { Task, TaskId } from "../../domain/types";
import { getNextStatus } from "../../domain/status";
import { toggleCompleteInstance } from "../../domain/recurrence";

export type SyncClient = MutationClient & {
  listTasks: () => Promise<Result<Task[], AppError>>;
};

export type TaskCacheStorage = {
  getTasks: () => Promise<Task[]>;
  setTasks: (tasks: Task[]) => Promise<void>;
  getLastSyncTime: () => Promise<number | null>;
  setLastSyncTime: (time: number) => Promise<void>;
};

const defaultCacheStorage: TaskCacheStorage = {
  getTasks: () => TypedStorage.getTasks(),
  setTasks: (tasks) => TypedStorage.setTasks(tasks),
  getLastSyncTime: () => TypedStorage.getLastSyncTime(),
  setLastSyncTime: (time) => TypedStorage.setLastSyncTime(time),
};

export class SyncEngine {
  private readonly cache: TaskCacheStorage;

  constructor(
    private readonly client: SyncClient | null,
    private readonly mutationQueue: MutationQueue,
    private readonly onTasksUpdated: (tasks: Task[]) => void,
    cache: TaskCacheStorage = defaultCacheStorage,
  ) {
    this.cache = cache;
  }

  async fullSync(): Promise<Result<void, AppError>> {
    if (this.client === null) {
      return err(new ConnectionError("API URL not configured"));
    }

    if (!this.mutationQueue.isEmpty) {
      await this.mutationQueue.replay(this.client);
    }

    const result = await this.client.listTasks();
    if (!result.ok) return result;

    let tasks = new Map<TaskId, Task>();
    for (const task of result.value) {
      tasks.set(task.id, task);
    }
    for (const remaining of this.mutationQueue.pending) {
      tasks = this.applyOptimistic(remaining, tasks);
    }
    const merged = [...tasks.values()];

    await this.cache.setTasks(merged);
    await this.cache.setLastSyncTime(Date.now());

    this.onTasksUpdated(merged);

    return OK_VOID;
  }

  applyOptimistic(
    mutation: Mutation,
    tasks: Map<TaskId, Task>,
  ): Map<TaskId, Task> {
    const next = new Map(tasks);

    switch (mutation.type) {
      case "create": {
        // Optimistic creates use a temporary ID; the real ID comes from sync
        break;
      }
      case "update": {
        const existing = next.get(mutation.taskId);
        if (existing) {
          const updates: Partial<Task> = {};
          for (const [key, value] of Object.entries(mutation.payload)) {
            if (value !== undefined) {
              Object.assign(updates, { [key]: value });
            }
          }
          next.set(mutation.taskId, { ...existing, ...updates });
        }
        break;
      }
      case "delete": {
        next.delete(mutation.taskId);
        break;
      }
      case "toggle_status": {
        const existing = next.get(mutation.taskId);
        if (existing) {
          const newStatus = getNextStatus(existing.status);
          next.set(mutation.taskId, {
            ...existing,
            status: newStatus,
          });
        }
        break;
      }
      case "complete_instance": {
        const existing = next.get(mutation.taskId);
        if (existing) {
          next.set(mutation.taskId, toggleCompleteInstance(existing));
        }
        break;
      }
    }

    return next;
  }

  async syncFromCache(): Promise<Task[]> {
    return this.cache.getTasks();
  }

  async getLastSyncTime(): Promise<number | null> {
    return this.cache.getLastSyncTime();
  }
}
