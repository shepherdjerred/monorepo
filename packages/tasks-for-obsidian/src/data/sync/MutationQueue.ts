import type { TaskNotesClient } from "../api/TaskNotesClient";
import { TypedStorage } from "../cache/storage";
import type { AppError } from "../../domain/errors";
import type { Result } from "../../domain/result";
import type { CreateTaskRequest, TaskId, UpdateTaskRequest } from "../../domain/types";
import type { TaskStatus } from "../../domain/status";

export type MutationType = "create" | "update" | "delete" | "toggle_status";

export type Mutation = {
  id: string;
  type: MutationType;
  taskId?: TaskId;
  payload: unknown;
  timestamp: number;
};

let counter = 0;
function generateId(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export class MutationQueue {
  private queue: Mutation[] = [];

  async enqueue(mutation: Omit<Mutation, "id" | "timestamp">): Promise<void> {
    this.queue.push({
      ...mutation,
      id: generateId(),
      timestamp: Date.now(),
    });
    await this.persist();
  }

  async replay(client: TaskNotesClient): Promise<Result<void, AppError>[]> {
    const results: Result<void, AppError>[] = [];
    const processed: Mutation[] = [];

    for (const mutation of this.queue) {
      const result = await this.executeMutation(client, mutation);
      if (result.ok) {
        processed.push(mutation);
      }
      results.push(result);
    }

    this.queue = this.queue.filter((m) => !processed.includes(m));
    await this.persist();

    return results;
  }

  async persist(): Promise<void> {
    await TypedStorage.setMutationQueue(JSON.stringify(this.queue));
  }

  async restore(): Promise<void> {
    const raw = await TypedStorage.getMutationQueue();
    if (!raw) {
      this.queue = [];
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      this.queue = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.queue = [];
    }
  }

  get pending(): readonly Mutation[] {
    return this.queue;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  private async executeMutation(
    client: TaskNotesClient,
    mutation: Mutation,
  ): Promise<Result<void, AppError>> {
    switch (mutation.type) {
      case "create": {
        const result = await client.createTask(mutation.payload as CreateTaskRequest);
        return result.ok ? { ok: true, value: undefined } : result;
      }
      case "update": {
        if (!mutation.taskId) return { ok: true, value: undefined };
        const result = await client.updateTask(mutation.taskId, mutation.payload as UpdateTaskRequest);
        return result.ok ? { ok: true, value: undefined } : result;
      }
      case "delete": {
        if (!mutation.taskId) return { ok: true, value: undefined };
        return client.deleteTask(mutation.taskId);
      }
      case "toggle_status": {
        if (!mutation.taskId) return { ok: true, value: undefined };
        const newStatus = (mutation.payload as { status: string } | undefined)?.status ?? "done";
        const result = await client.toggleTaskStatus(mutation.taskId, newStatus as TaskStatus);
        return result.ok ? { ok: true, value: undefined } : result;
      }
    }
  }
}
