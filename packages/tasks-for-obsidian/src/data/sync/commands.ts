import { z } from "zod";
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
} from "../../domain/base-schemas";

import type { AppError } from "../../domain/errors";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../../domain/types";
import {
  TaskIdSchema,
  contextName,
  projectName,
  tagName,
  taskId,
} from "../../domain/types";
import type { TaskStatus } from "../../domain/status";
import { TaskStatusSchema } from "../../domain/schemas";

/**
 * Offline-first sync commands.
 *
 * Every user mutation is recorded as a command with an absolute target state
 * — never a relative "toggle". Absolute state is what makes both the
 * on-device rebase and the server replay idempotent: replaying a command that
 * already applied is a no-op, so a crash between server-ack and client-dequeue
 * can safely re-send it (the server dedups on the command `id`).
 *
 * The command `id` doubles as the `X-Mutation-Id` idempotency key.
 */

export type Clock = () => number;

export const TEMP_ID_PREFIX = "tmp-";

export function isTempId(id: TaskId): boolean {
  return String(id).startsWith(TEMP_ID_PREFIX);
}

type CommandBase = {
  readonly id: string;
  readonly createdAt: number;
};

export type CreateCommand = CommandBase & {
  readonly type: "create";
  readonly tempId: TaskId;
  readonly payload: CreateTaskRequest;
};

export type UpdateCommand = CommandBase & {
  readonly type: "update";
  readonly taskId: TaskId;
  readonly payload: UpdateTaskRequest;
};

export type DeleteCommand = CommandBase & {
  readonly type: "delete";
  readonly taskId: TaskId;
};

export type SetStatusCommand = CommandBase & {
  readonly type: "set_status";
  readonly taskId: TaskId;
  readonly status: TaskStatus;
};

export type SetInstanceCompleteCommand = CommandBase & {
  readonly type: "set_instance_complete";
  readonly taskId: TaskId;
  readonly date: string;
  readonly completed: boolean;
};

export type Command =
  | CreateCommand
  | UpdateCommand
  | DeleteCommand
  | SetStatusCommand
  | SetInstanceCompleteCommand;

export type CommandInput =
  | Omit<CreateCommand, "id" | "createdAt">
  | Omit<UpdateCommand, "id" | "createdAt">
  | Omit<DeleteCommand, "id" | "createdAt">
  | Omit<SetStatusCommand, "id" | "createdAt">
  | Omit<SetInstanceCompleteCommand, "id" | "createdAt">;

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    createdAt: z.number(),
    type: z.literal("create"),
    tempId: TaskIdSchema,
    payload: CreateTaskRequestSchema,
  }),
  z.object({
    id: z.string(),
    createdAt: z.number(),
    type: z.literal("update"),
    taskId: TaskIdSchema,
    payload: UpdateTaskRequestSchema,
  }),
  z.object({
    id: z.string(),
    createdAt: z.number(),
    type: z.literal("delete"),
    taskId: TaskIdSchema,
  }),
  z.object({
    id: z.string(),
    createdAt: z.number(),
    type: z.literal("set_status"),
    taskId: TaskIdSchema,
    status: TaskStatusSchema,
  }),
  z.object({
    id: z.string(),
    createdAt: z.number(),
    type: z.literal("set_instance_complete"),
    taskId: TaskIdSchema,
    date: z.string(),
    completed: z.boolean(),
  }),
]);

/** Generates a command id / idempotency key that is unique across restarts. */
export function makeCommandIdFactory(clock: Clock): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    // A random suffix guards against collisions when two app instances (or a
    // relaunch that resets the counter) generate ids at the same clock tick.
    const rand = Math.floor(Math.random() * 0xff_ff_ff)
      .toString(36)
      .padStart(4, "0");
    return `${String(clock())}-${String(counter)}-${rand}`;
  };
}

let tempCounter = 0;
export function makeTempId(clock: Clock): TaskId {
  tempCounter += 1;
  return taskId(`${TEMP_ID_PREFIX}${String(clock())}-${String(tempCounter)}`);
}

/**
 * Build the optimistic Task shown immediately for an offline create, before
 * the server assigns a real id/path. This lives here (not in React) so the
 * rebase is a pure function testable without a component.
 */
export function materializeCreate(cmd: CreateCommand): Task {
  const req = cmd.payload;
  const now = new Date(cmd.createdAt).toISOString();
  return {
    id: cmd.tempId,
    path: "",
    title: req.title,
    status: req.status ?? "open",
    priority: req.priority ?? "normal",
    due: req.due,
    scheduled: req.scheduled,
    contexts:
      req.contexts === undefined ? [] : req.contexts.map((c) => contextName(c)),
    projects:
      req.projects === undefined ? [] : req.projects.map((p) => projectName(p)),
    tags: req.tags === undefined ? [] : req.tags.map((t) => tagName(t)),
    recurrence: req.recurrence,
    recurrenceAnchor: req.recurrenceAnchor,
    completeInstances: [],
    skippedInstances: [],
    timeEntries: [],
    blockedBy: [],
    reminders: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    extraFields: req.extraFields ?? {},
    details: req.details,
    dateCreated: now,
    dateModified: now,
  };
}

/**
 * Apply one command on top of a task map — the pure rebase step. Every branch
 * is idempotent: applying the same command twice yields the same result, which
 * is what lets the UI view be recomputed as `pending.reduce(applyCommand,
 * base)` on every change without persisting it.
 */
export function applyCommand(
  cmd: Command,
  tasks: ReadonlyMap<TaskId, Task>,
): Map<TaskId, Task> {
  const next = new Map(tasks);
  switch (cmd.type) {
    case "create": {
      // Materialize the optimistic task — fixes the "offline create vanishes"
      // bug where the old engine treated create as a no-op during rebase.
      next.set(cmd.tempId, materializeCreate(cmd));
      return next;
    }
    case "update": {
      const existing = next.get(cmd.taskId);
      if (existing === undefined) return next;
      const updates: Partial<Task> = {};
      for (const [key, value] of Object.entries(cmd.payload)) {
        if (value !== undefined) {
          Object.assign(updates, { [key]: value });
        }
      }
      next.set(cmd.taskId, { ...existing, ...updates });
      return next;
    }
    case "delete": {
      next.delete(cmd.taskId);
      return next;
    }
    case "set_status": {
      const existing = next.get(cmd.taskId);
      if (existing === undefined) return next;
      // Absolute set — never recompute from current status, so replaying is
      // idempotent (the old toggle-derived engine could flip the wrong way).
      next.set(cmd.taskId, { ...existing, status: cmd.status });
      return next;
    }
    case "set_instance_complete": {
      const existing = next.get(cmd.taskId);
      if (existing === undefined) return next;
      const has = existing.completeInstances.includes(cmd.date);
      if (cmd.completed === has) return next;
      const completeInstances = cmd.completed
        ? [...existing.completeInstances, cmd.date]
        : existing.completeInstances.filter((d) => d !== cmd.date);
      next.set(cmd.taskId, { ...existing, completeInstances });
      return next;
    }
  }
}

/** Rewrite a command's task reference from a temp id to the real server id. */
export function remapTaskId(cmd: Command, from: TaskId, to: TaskId): Command {
  switch (cmd.type) {
    case "create":
      return cmd.tempId === from ? { ...cmd, tempId: to } : cmd;
    case "update":
    case "delete":
    case "set_status":
    case "set_instance_complete":
      return cmd.taskId === from ? { ...cmd, taskId: to } : cmd;
  }
}

/** The task id a command targets (the temp id for creates). */
export function commandTarget(cmd: Command): TaskId {
  return cmd.type === "create" ? cmd.tempId : cmd.taskId;
}

export type FailureClass = "transient" | "permanent" | "not_found" | "auth";

/**
 * Classify a replay failure to decide retry behavior:
 * - transient  → stop draining, back off, retry (network / 5xx / 429)
 * - not_found  → the target was renamed/deleted server-side (404)
 * - auth       → 401/403; stop, surface the auth banner, retry later
 * - permanent  → 400/422 / validation; dead-letter, keep draining
 */
export function classify(error: AppError): FailureClass {
  switch (error.name) {
    case "ConnectionError":
    case "NetworkError":
      return "transient";
    case "NotFoundError":
      return "not_found";
    case "ValidationError":
      return "permanent";
    case "ApiError": {
      const status = "statusCode" in error ? error.statusCode : 0;
      if (status === 401 || status === 403) return "auth";
      if (status === 404) return "not_found";
      if (status === 429 || status >= 500) return "transient";
      return "permanent";
    }
    default:
      return "permanent";
  }
}
