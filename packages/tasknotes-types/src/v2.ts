import { z } from "zod";

/**
 * v2 contract — the upstream TaskNotes plugin HTTP API, adopted verbatim.
 *
 * Task payloads are `TaskInfo` from `@tasknotes/model` (the plugin's own
 * engine library): snake_case recurrence fields (`complete_instances`,
 * `recurrence_anchor`), path-as-ID semantics, config-driven statuses and
 * priorities. Every route/shape below was transcribed from the upstream
 * controllers (`src/api/*Controller.ts` @ upstream `main`, spec 0.2.x) —
 * see `packages/docs/plans/2026-07-03_tasknotes-first-in-class.md` (P3).
 *
 * The legacy camelCase contract lives in `./index` until P6 deletes it.
 */

// Everything the model exports is part of the v2 vocabulary: TaskInfo,
// TaskCreationData, TaskUpdateInput, StatusConfig/PriorityConfig,
// TaskNotesModelConfig + resolveModelConfig, parse/serialize/plan builders,
// recurrence helpers, and the conformance harness.
//
// NOTE: the model ships zod v3 schemas (its own bundled zod); they work at
// runtime but cannot type-compose with this package's zod v4. The wire
// schemas below are therefore v4 MIRRORS of the model's schemas — a test
// pins them key-for-key against `taskInfoSchema.shape` so drift fails loudly.
export * from "@tasknotes/model";

// ---------------------------------------------------------------------------
// TaskInfo wire schema (zod v4 mirror of the model's taskInfoSchema)
// ---------------------------------------------------------------------------

export const TimeEntryV2Schema = z.object({
  startTime: z.string(),
  endTime: z.string().optional(),
  description: z.string().optional(),
  duration: z.number().optional(),
});

export const ReminderV2Schema = z.object({
  id: z.string(),
  type: z.enum(["absolute", "relative"]),
  relatedTo: z.enum(["due", "scheduled"]).optional(),
  offset: z.string().optional(),
  absoluteTime: z.string().optional(),
  description: z.string().optional(),
});

export const TaskDependencyV2Schema = z.object({
  uid: z.string(),
  reltype: z.enum([
    "FINISHTOSTART",
    "FINISHTOFINISH",
    "STARTTOSTART",
    "STARTTOFINISH",
  ]),
  gap: z.string().optional(),
});

/** Mirrors `taskInfoSchema` from @tasknotes/model (spec 0.2.x), field for field. */
export const TaskInfoV2Schema = z.object({
  id: z.string().optional(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  due: z.string().optional(),
  scheduled: z.string().optional(),
  path: z.string(),
  archived: z.boolean(),
  tags: z.array(z.string()).optional(),
  contexts: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  recurrence: z.string().optional(),
  recurrence_anchor: z.enum(["scheduled", "completion"]).optional(),
  complete_instances: z.array(z.string()).optional(),
  skipped_instances: z.array(z.string()).optional(),
  recurrence_parent: z.string().optional(),
  occurrence_date: z.string().optional(),
  occurrence_materialization: z
    .enum(["manual", "on_completion", "rolling"])
    .optional(),
  occurrence_next_trigger: z
    .enum(["completion", "completion_or_skip"])
    .optional(),
  occurrence_template: z.string().optional(),
  occurrence_past_horizon: z.string().optional(),
  occurrence_future_horizon: z.string().optional(),
  completedDate: z.string().optional(),
  timeEstimate: z.number().optional(),
  timeEntries: z.array(TimeEntryV2Schema).optional(),
  totalTrackedTime: z.number().optional(),
  dateCreated: z.string().optional(),
  dateModified: z.string().optional(),
  icsEventId: z.array(z.string()).optional(),
  googleCalendarEventId: z.string().optional(),
  googleCalendarExceptionEventId: z.string().optional(),
  googleCalendarExceptionOriginalScheduled: z.string().optional(),
  googleCalendarMovedOriginalDates: z.array(z.string()).optional(),
  reminders: z.array(ReminderV2Schema).optional(),
  customProperties: z.record(z.string(), z.unknown()).optional(),
  basesData: z.unknown().optional(),
  blockedBy: z.array(TaskDependencyV2Schema).optional(),
  blocking: z.array(z.string()).optional(),
  isBlocked: z.boolean().optional(),
  isBlocking: z.boolean().optional(),
  hasSubtasks: z.boolean().optional(),
  details: z.string().optional(),
  sortOrder: z.string().optional(),
});

export type TaskInfoV2 = z.infer<typeof TaskInfoV2Schema>;

/** Client-generated idempotency key header (dedup persisted server-side). */
export const MUTATION_ID_HEADER = "X-Mutation-Id";

// ---------------------------------------------------------------------------
// Envelope — upstream wraps every response in { success, data | error }
// ---------------------------------------------------------------------------

export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data });
}

export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * POST /api/tasks — upstream accepts a `TaskCreationData` (Partial<TaskInfo>
 * + `details`); the only hard requirement is a non-empty title.
 */
export const TaskCreationRequestSchema = TaskInfoV2Schema.partial()
  .extend({
    title: z.string().min(1),
    details: z.string().optional(),
    creationContext: z.string().optional(),
  })
  .loose();

export type TaskCreationRequest = z.infer<typeof TaskCreationRequestSchema>;

/**
 * PUT /api/tasks/:id — Partial<TaskInfo> plus optional `details` body text.
 * `null` on a clearable field means REMOVE it (the model's plan builders
 * treat null as a frontmatter-key removal; upstream sends null to clear).
 */
export const TaskUpdateRequestSchema = TaskInfoV2Schema.partial()
  .extend({
    due: z.string().nullable().optional(),
    scheduled: z.string().nullable().optional(),
    recurrence: z.string().nullable().optional(),
    recurrence_anchor: z
      .enum(["scheduled", "completion"])
      .nullable()
      .optional(),
    completedDate: z.string().nullable().optional(),
    timeEstimate: z.number().nullable().optional(),
    details: z.string().nullable().optional(),
  })
  .loose();

export type TaskUpdateRequest = z.infer<typeof TaskUpdateRequestSchema>;

/**
 * POST /api/tasks/:id/complete-instance — upstream takes `{date?}` and
 * TOGGLES that instance. `completed` is this server's set-semantics
 * extension (P1): when present, the instance is set absolutely, which is
 * what makes the app's offline replay idempotent.
 */
export const CompleteInstanceRequestSchema = z.object({
  date: z.string().optional(),
  completed: z.boolean().optional(),
});

export type CompleteInstanceRequest = z.infer<
  typeof CompleteInstanceRequestSchema
>;

/** POST /api/nlp/parse and /api/nlp/create */
export const NlpRequestSchema = z.object({ text: z.string().min(1) });

// ---------------------------------------------------------------------------
// Responses (the `data` half of the envelope)
// ---------------------------------------------------------------------------

export const VaultInfoSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
});

export const PaginationSchema = z.object({
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
});

/** GET /api/tasks — default limit 50, cap 200, offset pagination. */
export const TaskListResponseSchema = z.object({
  tasks: z.array(TaskInfoV2Schema),
  pagination: PaginationSchema,
  vault: VaultInfoSchema,
  note: z.string().optional(),
});

/** POST /api/tasks/query — FilterQuery in, flattened matches out. */
export const TaskQueryResponseSchema = z.object({
  tasks: z.array(TaskInfoV2Schema),
  total: z.number(),
  filtered: z.number(),
  vault: VaultInfoSchema,
});

/** DELETE /api/tasks/:id */
export const DeleteResponseSchema = z.object({ message: z.string() });

/** GET /api/stats */
export const StatsResponseSchema = z.object({
  total: z.number(),
  completed: z.number(),
  active: z.number(),
  overdue: z.number(),
  archived: z.number(),
  withTimeTracking: z.number(),
});

/** GET /api/health */
export const HealthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
  vault: VaultInfoSchema,
});

/**
 * GET /api/filter-options — statuses/priorities are CONFIG OBJECTS (the
 * user's workflow), not bare strings; that mismatch was review finding #11.
 */
/** Mirrors `statusConfigSchema` from @tasknotes/model, field for field. */
export const StatusConfigV2Schema = z.object({
  id: z.string(),
  value: z.string(),
  label: z.string(),
  color: z.string(),
  icon: z.string().optional(),
  isCompleted: z.boolean(),
  isSkipped: z.boolean().optional(),
  excludeFromCycle: z.boolean().optional(),
  nextStatus: z.string().optional(),
  order: z.number(),
  autoArchive: z.boolean(),
  autoArchiveDelay: z.number(),
});

/** Mirrors `priorityConfigSchema` from @tasknotes/model, field for field. */
export const PriorityConfigV2Schema = z.object({
  id: z.string(),
  value: z.string(),
  label: z.string(),
  color: z.string(),
  icon: z.string().optional(),
  weight: z.number(),
});

export const FilterOptionsResponseSchema = z.object({
  statuses: z.array(StatusConfigV2Schema),
  priorities: z.array(PriorityConfigV2Schema),
  contexts: z.array(z.string()),
  projects: z.array(z.string()),
  tags: z.array(z.string()),
  folders: z.array(z.string()),
  userProperties: z.array(z.unknown()).optional(),
});

/** POST /api/nlp/parse → { parsed, taskData } */
export const NlpParseResponseSchema = z.object({
  parsed: z.record(z.string(), z.unknown()),
  taskData: TaskCreationRequestSchema,
});

/** POST /api/nlp/create → { task, parsed } (201) */
export const NlpCreateResponseSchema = z.object({
  task: TaskInfoV2Schema,
  parsed: z.record(z.string(), z.unknown()),
});

// --- time tracking (shapes from upstream src/utils/timeTrackingUtils.ts) ---

export const ActiveSessionInfoSchema = z.object({
  task: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    tags: z.array(z.string()),
    projects: z.array(z.string()),
  }),
  session: z.object({
    startTime: z.string(),
    description: z.string().optional(),
    elapsedMinutes: z.number(),
  }),
  elapsedMinutes: z.number(),
});

/** GET /api/time/active */
export const ActiveSessionsResponseSchema = z.object({
  activeSessions: z.array(ActiveSessionInfoSchema),
  totalActiveSessions: z.number(),
  totalElapsedMinutes: z.number(),
});

/** GET /api/time/summary */
export const TimeSummaryResponseSchema = z.object({
  period: z.string(),
  dateRange: z.object({ from: z.string(), to: z.string() }),
  summary: z.object({
    totalMinutes: z.number(),
    totalHours: z.number(),
    tasksWithTime: z.number(),
    activeTasks: z.number(),
    completedTasks: z.number(),
  }),
  topTasks: z.array(
    z.object({ task: z.string(), title: z.string(), minutes: z.number() }),
  ),
  topProjects: z.array(z.object({ project: z.string(), minutes: z.number() })),
  topTags: z
    .array(z.object({ tag: z.string(), minutes: z.number() }))
    .optional(),
});

/** GET /api/tasks/:id/time */
export const TaskTimeDataResponseSchema = z.object({
  task: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
  }),
  summary: z.object({
    totalMinutes: z.number(),
    totalHours: z.number(),
    totalSessions: z.number(),
    completedSessions: z.number(),
    activeSessions: z.number(),
  }),
  // Upstream appends per-session detail; keep it open until P5 needs it.
});

// --- calendars ---

/**
 * GET /api/calendars/events — this server derives events from tasks only
 * (due/scheduled + recurring expansion via `generateRecurringInstances`);
 * `sources` reports where events came from ({ tasks: n }).
 */
export const CalendarEventSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  allDay: z.boolean().optional(),
});

export const CalendarEventsResponseSchema = z.object({
  events: z.array(CalendarEventSchema),
  total: z.number(),
  sources: z.record(z.string(), z.number()),
});
