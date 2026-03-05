import type { TaskNotesClient } from "../api/TaskNotesClient";
import { TypedStorage } from "../cache/storage";
import type { MutationQueue, Mutation } from "./MutationQueue";
import type { AppError } from "../../domain/errors";
import { type Result, OK_VOID } from "../../domain/result";
import type { Task, TaskId } from "../../domain/types";
import { getNextStatus } from "../../domain/status";

export class SyncEngine {
  constructor(
    private readonly client: TaskNotesClient,
    private readonly mutationQueue: MutationQueue,
    private readonly onTasksUpdated: (tasks: Task[]) => void,
  ) {}

  async fullSync(): Promise<Result<void, AppError>> {
    // 1. Replay pending mutations
    if (!this.mutationQueue.isEmpty) {
      await this.mutationQueue.replay(this.client);
    }

    // 2. Fetch all tasks from server
    const result = await this.client.listTasks();
    if (!result.ok) return result;

    // 3. Update cache
    await TypedStorage.setTasks(result.value);
    await TypedStorage.setLastSyncTime(Date.now());

    // 4. Notify via callback
    this.onTasksUpdated(result.value);

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
    }

    return next;
  }

  async syncFromCache(): Promise<Task[]> {
    return TypedStorage.getTasks();
  }

  async getLastSyncTime(): Promise<number | null> {
    return TypedStorage.getLastSyncTime();
  }
}
