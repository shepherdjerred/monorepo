import { z } from "zod";

import type { TaskNotesClient } from "../api/TaskNotesClient";
import { TypedStorage } from "../cache/storage";
import type { AppError } from "../../domain/errors";
import type { Result } from "../../domain/result";
import type {
  CreateTaskRequest,
  TaskId,
  UpdateTaskRequest,
} from "../../domain/types";
import { TaskIdSchema } from "../../domain/types";
import type { TaskStatus } from "../../domain/status";
import { TaskStatusSchema } from "../../domain/schemas";

type BaseMutation = { id: string; timestamp: number };
type CreateMutation = BaseMutation & {
  type: "create";
  payload: CreateTaskRequest;
};
type UpdateMutation = BaseMutation & {
  type: "update";
  taskId: TaskId;
  payload: UpdateTaskRequest;
};
type DeleteMutation = BaseMutation & { type: "delete"; taskId: TaskId };
type ToggleStatusMutation = BaseMutation & {
  type: "toggle_status";
  taskId: TaskId;
  payload: { status: TaskStatus };
};

export type Mutation =
  | CreateMutation
  | UpdateMutation
  | DeleteMutation
  | ToggleStatusMutation;

type CreateMutationInput = Omit<CreateMutation, "id" | "timestamp">;
type UpdateMutationInput = Omit<UpdateMutation, "id" | "timestamp">;
type DeleteMutationInput = Omit<DeleteMutation, "id" | "timestamp">;
type ToggleStatusMutationInput = Omit<ToggleStatusMutation, "id" | "timestamp">;
export type MutationInput =
  | CreateMutationInput
  | UpdateMutationInput
  | DeleteMutationInput
  | ToggleStatusMutationInput;

const MutationSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    timestamp: z.number(),
    type: z.literal("create"),
    payload: z.object({
      title: z.string(),
      description: z.string().optional(),
      status: TaskStatusSchema.optional(),
      priority: z
        .enum(["highest", "high", "medium", "normal", "low", "none"])
        .optional(),
      due: z.string().optional(),
      scheduled: z.string().optional(),
      contexts: z.array(z.string()).optional(),
      projects: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      recurrence: z.string().optional(),
      timeEstimate: z.number().optional(),
    }),
  }),
  z.object({
    id: z.string(),
    timestamp: z.number(),
    type: z.literal("update"),
    taskId: TaskIdSchema,
    payload: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      status: TaskStatusSchema.optional(),
      priority: z
        .enum(["highest", "high", "medium", "normal", "low", "none"])
        .optional(),
      due: z.string().nullable().optional(),
      scheduled: z.string().nullable().optional(),
      contexts: z.array(z.string()).optional(),
      projects: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      recurrence: z.string().nullable().optional(),
      timeEstimate: z.number().nullable().optional(),
    }),
  }),
  z.object({
    id: z.string(),
    timestamp: z.number(),
    type: z.literal("delete"),
    taskId: TaskIdSchema,
  }),
  z.object({
    id: z.string(),
    timestamp: z.number(),
    type: z.literal("toggle_status"),
    taskId: TaskIdSchema,
    payload: z.object({
      status: TaskStatusSchema,
    }),
  }),
]);

let counter = 0;
function generateId(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export class MutationQueue {
  private queue: Mutation[] = [];

  async enqueue(mutation: MutationInput): Promise<void> {
    const base = { id: generateId(), timestamp: Date.now() };
    switch (mutation.type) {
      case "create":
        this.queue.push({
          ...base,
          type: mutation.type,
          payload: mutation.payload,
        });
        break;
      case "update":
        this.queue.push({
          ...base,
          type: mutation.type,
          taskId: mutation.taskId,
          payload: mutation.payload,
        });
        break;
      case "delete":
        this.queue.push({
          ...base,
          type: mutation.type,
          taskId: mutation.taskId,
        });
        break;
      case "toggle_status":
        this.queue.push({
          ...base,
          type: mutation.type,
          taskId: mutation.taskId,
          payload: mutation.payload,
        });
        break;
    }
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
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.queue = [];
        return;
      }
      const validated: Mutation[] = [];
      for (const item of parsed) {
        const result = MutationSchema.safeParse(item);
        if (result.success) {
          validated.push(result.data);
        }
      }
      this.queue = validated;
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
        const result = await client.createTask(mutation.payload);
        return result.ok ? { ok: true, value: undefined } : result;
      }
      case "update": {
        const result = await client.updateTask(
          mutation.taskId,
          mutation.payload,
        );
        return result.ok ? { ok: true, value: undefined } : result;
      }
      case "delete": {
        return client.deleteTask(mutation.taskId);
      }
      case "toggle_status": {
        const result = await client.toggleTaskStatus(
          mutation.taskId,
          mutation.payload.status,
        );
        return result.ok ? { ok: true, value: undefined } : result;
      }
    }
  }
}
