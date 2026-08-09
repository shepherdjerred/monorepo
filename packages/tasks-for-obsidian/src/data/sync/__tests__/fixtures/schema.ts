import { z } from "zod";

import {
  CreateTaskRequestSchema,
  PrioritySchema,
  TaskStatusSchema,
  UpdateTaskRequestSchema,
} from "../../../../domain/base-schemas";

/**
 * The language-neutral sync-scenario fixture format.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the format. The committed
 * JSON Schema at `packages/tasknotes-fixtures/schema/scenario.schema.json` is
 * generated from `ScenarioSchema` via `z.toJSONSchema()`, and
 * `fixtures.test.ts` fails if the two drift. A non-TypeScript runner (the
 * forthcoming Rust core) validates the same fixture files against that
 * generated JSON Schema, so a format change that is not mirrored into the
 * schema cannot be shipped.
 *
 * Everything here is a tagged union: `kind` for actions/assertions/values,
 * `type` for dispatch inputs, `method` for direct client calls, `by` for task
 * references. Tags map 1:1 onto Rust `#[serde(tag = "...")]` enums.
 *
 * Every object is strict — an unknown key is an error, not a silently
 * dropped field. That is what keeps the TypeScript reader and a JSON Schema
 * validator (which sees `additionalProperties: false`) in agreement.
 */

// ── Values ─────────────────────────────────────────────────────

/** Arbitrary JSON, used for `equals` comparands. Shared so `$defs` dedupes. */
const JsonValueSchema = z.json();

export const ErrorKindSchema = z.enum([
  "network",
  "api",
  "validation",
  "not_found",
  "connection",
]);
export type FixtureErrorKind = z.infer<typeof ErrorKindSchema>;

/**
 * An `AppError` as data. `status` is present exactly on `api` and
 * `not_found`; reconstruction is a five-arm switch onto the error classes.
 *
 * A `not_found` message must keep the shape the `NotFoundError` constructor
 * produces (`"<resource> not found: <id>"`) — the constructor takes the two
 * parts, not a message, so the deserializer splits on the marker and fails
 * loudly if it is missing.
 */
export const FixtureErrorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("network"), message: z.string() }),
  z.strictObject({
    kind: z.literal("api"),
    message: z.string(),
    status: z.int(),
  }),
  z.strictObject({ kind: z.literal("validation"), message: z.string() }),
  z.strictObject({
    kind: z.literal("not_found"),
    message: z.string(),
    status: z.literal(404),
  }),
  z.strictObject({ kind: z.literal("connection"), message: z.string() }),
]);
export type FixtureError = z.infer<typeof FixtureErrorSchema>;

/**
 * A point in time for the manual clock.
 *
 * `local_naive` exists because `FakeServer.completeRecurringInstance`'s
 * legacy no-body branch derives "server today" with device-local calendar
 * getters. Encoding those scenarios as an absolute epoch would make them
 * timezone-dependent; encoding them as a local wall-clock time (always local
 * noon in practice) reproduces the original test exactly in any timezone.
 */
export const FixtureTimeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("epoch_ms"), value: z.int() }),
  z.strictObject({
    kind: z.literal("local_naive"),
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u),
  }),
]);
export type FixtureTime = z.infer<typeof FixtureTimeSchema>;

/**
 * How an assertion or action names a task.
 *
 * - `id` — a literal vault-relative path.
 * - `ref` — the id of a task captured by `dispatch { as }` (the optimistic
 *   temp id for a create), verbatim and unaliased.
 * - `resolved_ref` — that id put through `TaskStore.resolveTaskId`, i.e. the
 *   real server id once a create has been acked.
 * - `title` — the first task in the inspected collection with this title.
 *
 * `ref` / `resolved_ref` always resolve against the CURRENT world, never
 * against a snapshot: ids are stable and the alias map only grows.
 */
export const TaskRefSchema = z.discriminatedUnion("by", [
  z.strictObject({ by: z.literal("id"), value: z.string() }),
  z.strictObject({ by: z.literal("ref"), value: z.string() }),
  z.strictObject({ by: z.literal("resolved_ref"), value: z.string() }),
  z.strictObject({ by: z.literal("title"), value: z.string() }),
]);
export type TaskRef = z.infer<typeof TaskRefSchema>;

/** A count, either literal or "whatever the same metric was at a snapshot". */
export const CountExprSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.int() }),
  z.strictObject({ kind: z.literal("snapshot"), name: z.string() }),
]);
export type CountExpr = z.infer<typeof CountExprSchema>;

/** Overrides handed to `makeTask` (seeding) or `injectServerEdit` (patching). */
export const TaskFieldsSchema = z.strictObject({
  id: z.string().optional(),
  path: z.string().optional(),
  title: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  due: z.string().optional(),
  scheduled: z.string().optional(),
  recurrence: z.string().optional(),
  completeInstances: z.array(z.string()).optional(),
  skippedInstances: z.array(z.string()).optional(),
  contexts: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  details: z.string().optional(),
});
export type TaskFields = z.infer<typeof TaskFieldsSchema>;

const StrictCreateRequestSchema = CreateTaskRequestSchema.strict();
const StrictUpdateRequestSchema = UpdateTaskRequestSchema.strict();

export const MutationMethodSchema = z.enum([
  "createTask",
  "updateTask",
  "deleteTask",
  "toggleTaskStatus",
  "completeRecurringInstance",
  "listTasks",
]);

export const SyncStateSchema = z.enum([
  "idle",
  "syncing",
  "backoff",
  "auth_error",
  "unconfigured",
]);

// ── Actions ────────────────────────────────────────────────────

/** A mutation as the UI expresses it, with the task named by reference. */
export const DispatchInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("create"),
    payload: StrictCreateRequestSchema,
  }),
  z.strictObject({
    type: z.literal("update"),
    task: TaskRefSchema,
    payload: StrictUpdateRequestSchema,
  }),
  z.strictObject({ type: z.literal("delete"), task: TaskRefSchema }),
  z.strictObject({
    type: z.literal("set_status"),
    task: TaskRefSchema,
    status: TaskStatusSchema,
  }),
  z.strictObject({
    type: z.literal("set_instance_complete"),
    task: TaskRefSchema,
    date: z.string(),
    completed: z.boolean(),
  }),
]);
export type FixtureDispatchInput = z.infer<typeof DispatchInputSchema>;

/** A call made straight at the fake server, bypassing store and engine. */
export const ClientCallSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("listTasks") }),
  z.strictObject({
    method: z.literal("createTask"),
    request: StrictCreateRequestSchema,
    mutationId: z.string().optional(),
  }),
  z.strictObject({
    method: z.literal("updateTask"),
    task: TaskRefSchema,
    request: StrictUpdateRequestSchema,
    mutationId: z.string().optional(),
  }),
  z.strictObject({
    method: z.literal("deleteTask"),
    task: TaskRefSchema,
    mutationId: z.string().optional(),
  }),
  z.strictObject({
    method: z.literal("toggleTaskStatus"),
    task: TaskRefSchema,
    status: TaskStatusSchema,
    mutationId: z.string().optional(),
  }),
  z.strictObject({
    method: z.literal("completeRecurringInstance"),
    task: TaskRefSchema,
    /** `null` exercises the legacy toggle-server-today branch. */
    instance: z
      .strictObject({ date: z.string(), completed: z.boolean() })
      .nullable(),
    mutationId: z.string().optional(),
  }),
]);
export type FixtureClientCall = z.infer<typeof ClientCallSchema>;

/**
 * The seventeen verbs a scenario runner must implement.
 *
 * Two deserve emphasis:
 *
 * - `snapshot` captures BOTH the durable client storage (queue + task cache,
 *   for `relaunch`) and the complete observable world state (for assertions
 *   with `at`). One verb, because every crash test needs both halves at the
 *   same instant.
 * - `relaunch` rebuilds the client stack — command queue, task store, sync
 *   engine, retry scheduler — from a named snapshot's durable storage. The
 *   CLOCK AND THE SERVER SURVIVE: only client state is replaced, exactly as
 *   when a phone is killed and reopened against a server that remembers what
 *   it already applied. A snapshot may be reused after later actions have
 *   run, which is how the crash-before-ack scenario relaunches from
 *   deliberately stale durable state.
 */
export const ActionSchema = z.discriminatedUnion("kind", [
  /** `TaskStore.restore()` — load queue, cached base and aliases. */
  z.strictObject({ kind: z.literal("store_restore") }),
  z.strictObject({
    kind: z.literal("server_seed"),
    tasks: z.array(TaskFieldsSchema),
  }),
  z.strictObject({ kind: z.literal("server_offline") }),
  z.strictObject({ kind: z.literal("server_online") }),
  z.strictObject({
    kind: z.literal("server_fail_next"),
    method: MutationMethodSchema,
    error: FixtureErrorSchema,
  }),
  /** A concurrent Obsidian edit landing straight in the server's state. */
  z.strictObject({
    kind: z.literal("server_inject_edit"),
    task: TaskRefSchema,
    patch: TaskFieldsSchema,
  }),
  z.strictObject({ kind: z.literal("clock_set"), at: FixtureTimeSchema }),
  z.strictObject({
    kind: z.literal("dispatch"),
    input: DispatchInputSchema,
    /** Binds the resulting optimistic task's id for later `ref` lookups. */
    as: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("sync_now"),
    /** Binds the settled sync result for later `result` assertions. */
    as: z.string().optional(),
  }),
  /** Fire-and-forget trigger (`SyncEngine.requestSync`). */
  z.strictObject({ kind: z.literal("request_sync") }),
  /** Fire the oldest pending retry timer. Errors if none is armed. */
  z.strictObject({ kind: z.literal("scheduler_fire_next") }),
  z.strictObject({ kind: z.literal("engine_dispose") }),
  z.strictObject({
    kind: z.literal("retry_dead_letter"),
    index: z.int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("client_call"),
    call: ClientCallSchema,
    as: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("snapshot"), as: z.string() }),
  z.strictObject({ kind: z.literal("relaunch"), from: z.string() }),
  /** Let already-triggered fire-and-forget work settle before continuing. */
  z.strictObject({ kind: z.literal("settle") }),
]);
export type FixtureAction = z.infer<typeof ActionSchema>;

// ── Assertions ─────────────────────────────────────────────────

/** Which task collection an assertion inspects. */
export const TaskSourceSchema = z.enum(["store", "server"]);

const CALL_LOG_FIELDS = z.enum([
  "method",
  "id",
  "mutationId",
  "replayed",
  "applied",
]);

/**
 * Assertions are declarative and evaluated after every action has run. To
 * assert on a mid-flight state, take a `snapshot` at that moment and point
 * the assertion at it with `at`. Omitting `at` means the final state.
 */
export const AssertionSchema = z.discriminatedUnion("kind", [
  /** A bound `sync_now` / `client_call` outcome. */
  z.strictObject({
    kind: z.literal("result"),
    ref: z.string(),
    ok: z.boolean(),
    errorKind: ErrorKindSchema.optional(),
  }),
  /** A dotted path into a bound result (`value.title`, `value.0.title`). */
  z.strictObject({
    kind: z.literal("result_field"),
    ref: z.string(),
    path: z.string(),
    equals: JsonValueSchema,
  }),
  /** Two bound results agree at a path, without pinning the value. */
  z.strictObject({
    kind: z.literal("results_field_equal"),
    refs: z.tuple([z.string(), z.string()]),
    path: z.string(),
  }),
  /** Unsynced commands still in the queue. */
  z.strictObject({
    kind: z.literal("pending_count"),
    at: z.string().optional(),
    equals: CountExprSchema,
  }),
  /** The queue's pending commands equal, verbatim, those at a snapshot. */
  z.strictObject({
    kind: z.literal("queue_pending_equals"),
    at: z.string(),
  }),
  z.strictObject({
    kind: z.literal("task_count"),
    at: z.string().optional(),
    source: TaskSourceSchema,
    equals: CountExprSchema,
  }),
  z.strictObject({
    kind: z.literal("task_field"),
    at: z.string().optional(),
    source: TaskSourceSchema,
    task: TaskRefSchema,
    path: z.string(),
    equals: JsonValueSchema,
  }),
  z.strictObject({
    kind: z.literal("task_exists"),
    at: z.string().optional(),
    source: TaskSourceSchema,
    task: TaskRefSchema,
    exists: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("dead_letter_count"),
    at: z.string().optional(),
    equals: z.int().nonnegative(),
  }),
  /** A dotted path into a dead letter (`error.status`, `command.type`). */
  z.strictObject({
    kind: z.literal("dead_letter_field"),
    at: z.string().optional(),
    index: z.int().nonnegative(),
    path: z.string(),
    equals: JsonValueSchema,
  }),
  z.strictObject({
    kind: z.literal("last_sync_time"),
    at: z.string().optional(),
    equals: FixtureTimeSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("engine_state"),
    at: z.string().optional(),
    equals: SyncStateSchema,
  }),
  /** Armed retry timers: how many, and/or their exact delays in order. */
  z.strictObject({
    kind: z.literal("scheduler_pending"),
    at: z.string().optional(),
    count: z.int().nonnegative().optional(),
    delays: z.array(z.int()).optional(),
  }),
  /** Wire calls seen by the server; `applied: true` excludes failures and replays. */
  z.strictObject({
    kind: z.literal("call_count"),
    at: z.string().optional(),
    method: MutationMethodSchema,
    applied: z.boolean().optional(),
    equals: z.int().nonnegative(),
  }),
  /**
   * One field of the server call log. With `index`, the field of that call;
   * without, the field projected across every call as an array.
   */
  z.strictObject({
    kind: z.literal("call_log"),
    at: z.string().optional(),
    index: z.int().nonnegative().optional(),
    field: CALL_LOG_FIELDS,
    equals: JsonValueSchema,
  }),
  z.strictObject({
    kind: z.literal("task_id_is_temp"),
    task: TaskRefSchema,
    equals: z.boolean(),
  }),
  /**
   * Meta-assertion: re-run the whole scenario in a fresh world and require
   * the end state (server tasks, visible tasks, pending count) to be
   * byte-identical. Pins determinism of the simulation itself.
   */
  z.strictObject({ kind: z.literal("deterministic_end_state") }),
]);
export type FixtureAssertion = z.infer<typeof AssertionSchema>;

// ── Scenario ───────────────────────────────────────────────────

export const SetupSchema = z.strictObject({
  /** Manual clock start. Defaults to epoch 1750000000000. */
  clock: FixtureTimeSchema.optional(),
  /** Wire dispatch → requestSync like the real app. Defaults to false. */
  autoSync: z.boolean().optional(),
});

export const ScenarioSchema = z.strictObject({
  /** Stable, unique, kebab-case. Also the fixture's file name. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  /** Test file this scenario is executed from. */
  source: z.string(),
  /** `describe` block title, preserved from the original suite. */
  describe: z.string(),
  /** `test` title, preserved from the original suite. */
  name: z.string(),
  /** Narrative for humans; runners ignore it. */
  doc: z.string().optional(),
  setup: SetupSchema,
  actions: z.array(ActionSchema),
  assertions: z.array(AssertionSchema).min(1),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/** The JSON Schema committed to `packages/tasknotes-fixtures/schema/`. */
export function scenarioJsonSchema(): unknown {
  return z.toJSONSchema(ScenarioSchema, { target: "draft-2020-12" });
}
