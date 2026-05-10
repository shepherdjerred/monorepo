import { z } from "zod";
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
} from "tasknotes-types";

import { TypedStorage } from "../cache/storage";
import type { AppError } from "../../domain/errors";
import type { Result } from "../../domain/result";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../../domain/types";
import { TaskIdSchema } from "../../domain/types";
import type { TaskStatus } from "../../domain/status";
import { TaskStatusSchema } from "../../domain/schemas";

export type MutationClient = {
  createTask: (req: CreateTaskRequest) => Promise<Result<Task, AppError>>;
  updateTask: (
    id: TaskId,
    req: UpdateTaskRequest,
  ) => Promise<Result<Task, AppError>>;
  deleteTask: (id: TaskId) => Promise<Result<void, AppError>>;
  toggleTaskStatus: (
    id: TaskId,
    status: TaskStatus,
  ) => Promise<Result<Task, AppError>>;
  completeRecurringInstance: (id: TaskId) => Promise<Result<Task, AppError>>;
};

export type MutationStorage = {
  read: () => Promise<string | null>;
  write: (data: string) => Promise<void>;
};

const defaultStorage: MutationStorage = {
  read: () => TypedStorage.getMutationQueue(),
  write: (data) => TypedStorage.setMutationQueue(data),
};

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
type CompleteInstanceMutation = BaseMutation & {
  type: "complete_instance";
  taskId: TaskId;
};

export type Mutation =
  | CreateMutation
  | UpdateMutation
  | DeleteMutation
  | ToggleStatusMutation
  | CompleteInstanceMutation;

type CreateMutationInput = Omit<CreateMutation, "id" | "timestamp">;
type UpdateMutationInput = Omit<UpdateMutation, "id" | "timestamp">;
type DeleteMutationInput = Omit<DeleteMutation, "id" | "timestamp">;
type ToggleStatusMutationInput = Omit<ToggleStatusMutation, "id" | "timestamp">;
type CompleteInstanceMutationInput = Omit<
  CompleteInstanceMutation,
  "id" | "timestamp"
>;
export type MutationInput =
  | CreateMutationInput
  | UpdateMutationInput
  | DeleteMutationInput
  | ToggleStatusMutationInput
  | CompleteInstanceMutationInput;

const MutationSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    timestamp: z.number(),
    type: z.literal("create"),
    payload: CreateTaskRequestSchema,
  }),
  z.object({
    id: z.string(),
    timestamp: z.number(),
    type: z.literal("update"),
    taskId: TaskIdSchema,
    payload: UpdateTaskRequestSchema,
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
  z.object({
    id: z.string(),
    timestamp: z.number(),
    type: z.literal("complete_instance"),
    taskId: TaskIdSchema,
  }),
]);

let counter = 0;
function generateId(): string {
  counter += 1;
  return `${String(Date.now())}-${String(counter)}`;
}

export class MutationQueue {
  private queue: Mutation[] = [];
  private readonly storage: MutationStorage;

  constructor(storage: MutationStorage = defaultStorage) {
    this.storage = storage;
  }

  async enqueue(mutation: MutationInput): Promise<Mutation> {
    const base = { id: generateId(), timestamp: Date.now() };
    let entry: Mutation;
    switch (mutation.type) {
      case "create":
        entry = { ...base, type: mutation.type, payload: mutation.payload };
        break;
      case "update":
        entry = {
          ...base,
          type: mutation.type,
          taskId: mutation.taskId,
          payload: mutation.payload,
        };
        break;
      case "delete":
        entry = { ...base, type: mutation.type, taskId: mutation.taskId };
        break;
      case "toggle_status":
        entry = {
          ...base,
          type: mutation.type,
          taskId: mutation.taskId,
          payload: mutation.payload,
        };
        break;
      case "complete_instance":
        entry = { ...base, type: mutation.type, taskId: mutation.taskId };
        break;
    }
    this.queue.push(entry);
    await this.persist();
    return entry;
  }

  async replay(client: MutationClient): Promise<Result<void, AppError>[]> {
    const results: Result<void, AppError>[] = [];
    const processed = new Set<string>();

    for (const mutation of this.queue) {
      const result = await this.executeMutation(client, mutation);
      if (result.ok) {
        processed.add(mutation.id);
      }
      results.push(result);
    }

    this.queue = this.queue.filter((m) => !processed.has(m.id));
    await this.persist();

    return results;
  }

  async persist(): Promise<void> {
    await this.storage.write(JSON.stringify(this.queue));
  }

  async restore(): Promise<void> {
    const raw = await this.storage.read();
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
    client: MutationClient,
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
      case "complete_instance": {
        const result = await client.completeRecurringInstance(mutation.taskId);
        return result.ok ? { ok: true, value: undefined } : result;
      }
    }
  }
}
