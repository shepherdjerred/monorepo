import type { AppError } from "../../../../domain/errors";
import type { Result } from "../../../../domain/result";
import type { Task, TaskId } from "../../../../domain/types";
import {
  contextName,
  projectName,
  tagName,
  taskId,
} from "../../../../domain/types";
import type { DeadLetterEntry } from "../../CommandQueue";
import type { Command } from "../../commands";
import type { SyncState } from "../../SyncEngine";
import type { CallLogEntry, Harness } from "../harness";
import type {
  MemoryQueueStorage,
  MemoryStoreStorage,
} from "../harness-storage";
import type { CountExpr, FixtureTime, TaskFields, TaskRef } from "./schema";

/**
 * The simulated world a scenario runs against, plus the pure lookups both
 * actions and assertions need. Nothing here executes a verb — see
 * `./actions.ts` and `./assertions.ts`.
 */

/** Everything an assertion can look at, frozen at one instant. */
export type WorldView = {
  readonly pendingCount: number;
  readonly pendingCommands: readonly Command[];
  readonly storeTasks: ReadonlyMap<TaskId, Task>;
  readonly deadLetters: readonly DeadLetterEntry[];
  readonly lastSyncTime: number | null;
  readonly engineState: SyncState;
  readonly schedulerDelays: readonly number[];
  readonly serverTasks: ReadonlyMap<TaskId, Task>;
  readonly serverCalls: readonly CallLogEntry[];
};

/** Durable client storage plus the observable state, captured together. */
export type SnapshotRecord = {
  readonly queueStorage: MemoryQueueStorage;
  readonly storeStorage: MemoryStoreStorage;
  readonly view: WorldView;
};

export type RunState = {
  harness: Harness;
  readonly autoSync: boolean;
  readonly results: Map<string, Result<unknown, AppError>>;
  readonly taskIds: Map<string, TaskId>;
  readonly snapshots: Map<string, SnapshotRecord>;
};

export function captureView(harness: Harness): WorldView {
  const snapshot = harness.store.getSnapshot();
  return {
    pendingCount: harness.queue.pending.length,
    pendingCommands: [...harness.queue.pending],
    storeTasks: new Map(snapshot.tasks),
    deadLetters: [...snapshot.deadLetters],
    lastSyncTime: snapshot.lastSyncTime,
    engineState: harness.engine.getStatus().state,
    schedulerDelays: harness.scheduler.pending().map((timer) => timer.ms),
    serverTasks: new Map(harness.server.tasks),
    serverCalls: harness.server.calls.map((call) => ({ ...call })),
  };
}

/** The named snapshot's frozen state, or the live world when `at` is absent. */
export function viewAt(state: RunState, at: string | undefined): WorldView {
  if (at === undefined) return captureView(state.harness);
  const record = state.snapshots.get(at);
  if (record === undefined) throw new Error(`unknown snapshot "${at}"`);
  return record.view;
}

export function boundResult(
  state: RunState,
  ref: string,
): Result<unknown, AppError> {
  const result = state.results.get(ref);
  if (result === undefined) throw new Error(`no result bound to ref "${ref}"`);
  return result;
}

export function tasksOf(
  view: WorldView,
  source: "store" | "server",
): ReadonlyMap<TaskId, Task> {
  return source === "store" ? view.storeTasks : view.serverTasks;
}

export function countOf(
  state: RunState,
  expr: CountExpr,
  metric: (view: WorldView) => number,
): number {
  switch (expr.kind) {
    case "literal":
      return expr.value;
    case "snapshot":
      return metric(viewAt(state, expr.name));
  }
}

export function resolveTime(time: FixtureTime): number {
  switch (time.kind) {
    case "epoch_ms":
      return time.value;
    case "local_naive":
      // No trailing Z: parsed in the runtime's local zone, matching the
      // device-local calendar arithmetic the fake server performs.
      return new Date(time.value).getTime();
  }
}

type MutableTask = { -readonly [K in keyof Task]?: Task[K] };

/** Fixture task fields as a `Partial<Task>`, setting only what was given. */
export function taskOverrides(fields: TaskFields): Partial<Task> {
  const out: MutableTask = {};
  if (fields.id !== undefined) out.id = taskId(fields.id);
  if (fields.path !== undefined) out.path = fields.path;
  if (fields.title !== undefined) out.title = fields.title;
  if (fields.status !== undefined) out.status = fields.status;
  if (fields.priority !== undefined) out.priority = fields.priority;
  if (fields.due !== undefined) out.due = fields.due;
  if (fields.scheduled !== undefined) out.scheduled = fields.scheduled;
  if (fields.recurrence !== undefined) out.recurrence = fields.recurrence;
  if (fields.completeInstances !== undefined) {
    out.completeInstances = fields.completeInstances;
  }
  if (fields.skippedInstances !== undefined) {
    out.skippedInstances = fields.skippedInstances;
  }
  if (fields.contexts !== undefined) {
    out.contexts = fields.contexts.map((value) => contextName(value));
  }
  if (fields.projects !== undefined) {
    out.projects = fields.projects.map((value) => projectName(value));
  }
  if (fields.tags !== undefined) {
    out.tags = fields.tags.map((value) => tagName(value));
  }
  if (fields.archived !== undefined) out.archived = fields.archived;
  if (fields.details !== undefined) out.details = fields.details;
  return out;
}

function boundTaskId(state: RunState, name: string): TaskId {
  const bound = state.taskIds.get(name);
  if (bound === undefined) throw new Error(`no task bound to ref "${name}"`);
  return bound;
}

export function findByTitle(
  tasks: ReadonlyMap<TaskId, Task>,
  title: string,
): TaskId | undefined {
  for (const task of tasks.values()) {
    if (task.title === title) return task.id;
  }
  return undefined;
}

/**
 * Resolve a task reference. `collection` is only consulted for `by: "title"`;
 * ids and bound refs always resolve against the live world, since ids are
 * stable and the alias map only ever grows.
 */
export function resolveTaskRef(
  state: RunState,
  ref: TaskRef,
  collection: ReadonlyMap<TaskId, Task>,
): TaskId {
  switch (ref.by) {
    case "id":
      return taskId(ref.value);
    case "ref":
      return boundTaskId(state, ref.value);
    case "resolved_ref":
      return state.harness.store.resolveTaskId(boundTaskId(state, ref.value));
    case "title": {
      const found = findByTitle(collection, ref.value);
      if (found === undefined) {
        throw new Error(`no task titled "${ref.value}" in the inspected set`);
      }
      return found;
    }
  }
}

/** Task refs used by actions search the visible store, then the server. */
export function actionTaskId(state: RunState, ref: TaskRef): TaskId {
  if (ref.by !== "title") return resolveTaskRef(state, ref, new Map());
  const visible = state.harness.store.getSnapshot().tasks;
  const inStore = findByTitle(visible, ref.value);
  return inStore ?? resolveTaskRef(state, ref, state.harness.server.tasks);
}

/** Walk a dotted path; numeric segments index arrays. */
export function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        throw new TypeError(`path segment "${segment}" is not an array index`);
      }
      current = current.at(index);
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = Reflect.get(current, segment);
  }
  return current;
}

export function callLogField(call: CallLogEntry, field: string): unknown {
  switch (field) {
    case "method":
      return call.method;
    case "id":
      return call.id;
    case "mutationId":
      return call.mutationId;
    case "replayed":
      return call.replayed;
    case "applied":
      return call.applied;
    default:
      throw new Error(`unknown call log field "${field}"`);
  }
}

/**
 * The state the determinism meta-assertion compares: server tasks, the
 * visible task map, and the pending count. Deliberately excludes command ids
 * and temp ids, which carry randomness by design.
 */
export function endStateDigest(state: RunState): unknown {
  const snapshot = state.harness.store.getSnapshot();
  return {
    serverTasks: [...state.harness.server.tasks.entries()],
    view: [...snapshot.tasks.entries()],
    pending: snapshot.pendingCount,
  };
}
