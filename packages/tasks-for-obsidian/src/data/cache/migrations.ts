import { z } from "zod";
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
} from "tasknotes-types";

import { TaskIdSchema } from "../../domain/types";
import { TaskStatusSchema } from "../../domain/schemas";
import { localTodayYmd } from "../../domain/recurrence";
import {
  type Command,
  makeCommandIdFactory,
  makeTempId,
} from "../sync/commands";
import { TypedStorage } from "./storage";

/**
 * One-time AsyncStorage migrations, gated by `storage_schema_version`.
 *
 * v0 (absent) → v2: the old MutationQueue stored relative "toggle" mutations
 * under `mutation_queue`. Convert each to an absolute-state Command in
 * `mutation_queue_v2` so a queue persisted by the previous app version isn't
 * silently dropped on upgrade. The base task cache (`tasks_cache`) is already
 * a server snapshot and is reused as-is (per-element salvage in getTasks
 * handles stragglers).
 */

export const CURRENT_SCHEMA_VERSION = 2;

// Frozen copy of the v1 mutation shape (do NOT import the live schema — it is
// being deleted; this migration must keep reading the old format forever).
const V1MutationSchema = z.discriminatedUnion("type", [
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
    payload: z.object({ status: TaskStatusSchema }),
  }),
  z.object({
    id: z.string(),
    timestamp: z.number(),
    type: z.literal("complete_instance"),
    taskId: TaskIdSchema,
  }),
]);

type V1Mutation = z.infer<typeof V1MutationSchema>;

function ymdOf(timestampMs: number): string {
  return localTodayYmd(new Date(timestampMs));
}

/** Convert one v1 mutation to a v2 command, or null to drop it. */
function convert(m: V1Mutation, nextId: () => string): Command | null {
  const base = { id: nextId(), createdAt: m.timestamp };
  switch (m.type) {
    case "create":
      // Nothing referenced the old optimistic task (it was never persisted),
      // so a fresh temp id is safe.
      return {
        ...base,
        type: "create",
        tempId: makeTempId(() => m.timestamp),
        payload: m.payload,
      };
    case "update":
      return { ...base, type: "update", taskId: m.taskId, payload: m.payload };
    case "delete":
      return { ...base, type: "delete", taskId: m.taskId };
    case "toggle_status":
      return {
        ...base,
        type: "set_status",
        taskId: m.taskId,
        status: m.payload.status,
      };
    case "complete_instance":
      // The enqueue timestamp is the best record of the tapped day; v1 only
      // enqueued on a completion tap, so direction is `true`.
      return {
        ...base,
        type: "set_instance_complete",
        taskId: m.taskId,
        date: ymdOf(m.timestamp),
        completed: true,
      };
  }
}

export type MigrationStorage = {
  getSchemaVersion: () => Promise<number>;
  setSchemaVersion: (v: number) => Promise<void>;
  getLegacyQueue: () => Promise<string | null>;
  removeLegacyQueue: () => Promise<void>;
  getQueueV2: () => Promise<string | null>;
  setQueueV2: (data: string) => Promise<void>;
};

const defaultStorage: MigrationStorage = {
  getSchemaVersion: () => TypedStorage.getSchemaVersion(),
  setSchemaVersion: (v) => TypedStorage.setSchemaVersion(v),
  getLegacyQueue: () => TypedStorage.getMutationQueue(),
  removeLegacyQueue: () => TypedStorage.removeMutationQueue(),
  getQueueV2: () => TypedStorage.getQueueV2(),
  setQueueV2: (data) => TypedStorage.setQueueV2(data),
};

/**
 * Run pending migrations. Idempotent: returns immediately once the stored
 * version matches CURRENT_SCHEMA_VERSION. Call once at startup, before any
 * store reads the queue.
 */
export async function runMigrations(
  storage: MigrationStorage = defaultStorage,
  clock: () => number = Date.now,
): Promise<void> {
  const version = await storage.getSchemaVersion();
  if (version >= CURRENT_SCHEMA_VERSION) return;

  // v0 → v2 queue conversion. Skip if a v2 queue already exists (partial run).
  const existingV2 = await storage.getQueueV2();
  if (existingV2 === null) {
    const legacy = await storage.getLegacyQueue();
    const commands = migrateV1Queue(legacy, clock);
    if (commands.length > 0) {
      await storage.setQueueV2(JSON.stringify(commands));
    }
  }
  await storage.removeLegacyQueue();
  await storage.setSchemaVersion(CURRENT_SCHEMA_VERSION);
}

/** Pure v1-queue-string → v2-command-list (exported for tests). */
export function migrateV1Queue(
  legacy: string | null,
  clock: () => number = Date.now,
): Command[] {
  if (!legacy) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(legacy);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const nextId = makeCommandIdFactory(clock);
  const commands: Command[] = [];
  for (const item of parsed) {
    const result = V1MutationSchema.safeParse(item);
    if (!result.success) continue; // drop unparseable entries (matches v1)
    const command = convert(result.data, nextId);
    if (command !== null) commands.push(command);
  }
  return commands;
}
