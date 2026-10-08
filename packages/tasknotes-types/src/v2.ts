import { z } from "zod";

/**
 * TaskNotes task API, using the upstream plugin's nontracking vocabulary.
 *
 * Task payloads are `TaskInfo` from `@tasknotes/model` (the plugin's own
 * engine library): snake_case recurrence fields (`complete_instances`,
 * `recurrence_anchor`), path-as-ID semantics, config-driven statuses and
 * priorities. Time tracking, Pomodoro and estimates are excluded from the
 * public task contract; existing vault metadata remains opaque to the app.
 */

// Curated model adapters retain task, recurrence and configuration behavior.
//
// NOTE: the model ships zod v3 schemas (its own bundled zod); they work at
// runtime but cannot type-compose with this package's zod v4. The wire
// schemas below mirror its supported fields. Drift tests explicitly exclude
// only the three retired task fields and pin every other key and optionality.
export {
  DEFAULT_DEPENDENCY_RELTYPE,
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  TASKNOTES_SPEC_VERSION,
  VALID_DEPENDENCY_RELTYPES,
  addDTSTARTToRecurrenceRule,
  addDTSTARTToRecurrenceRuleWithDraggedTime,
  applyFrontmatterPatch,
  buildMaterializeOccurrencePlan,
  buildMaterializedOccurrenceCompletePlan,
  buildMaterializedOccurrenceSkipPlan,
  buildMaterializedOccurrenceUncompletePlan,
  buildMaterializedOccurrenceUnskipPlan,
  buildRecurringTaskCompletePlan,
  buildRecurringTaskSkippedPlan,
  buildSpecCompleteTaskUpdate,
  buildSpecRecurringSkipUpdate,
  buildTaskPropertyUpdatePlan,
  buildTaskUpdatePlan,
  buildTaskUpdateRecurrenceUpdates,
  buildUpdatedTaskFromPlan,
  coerceStatusFrontmatterValue,
  completeRecurringTask,
  conformanceMetadata,
  createUTCDateForRRule,
  createUTCDateFromLocalCalendarDate,
  defaultOccurrenceParentReference,
  denormalizeSpecFrontmatter,
  detectTaskFile,
  extractDependencyUid,
  findMaterializedOccurrence,
  formatDateAsUTCString,
  formatDateForStorage,
  generateRecurringInstances,
  getCurrentDateString,
  getDatePart,
  getDefaultCompletedStatus,
  getDefaultSkippedStatus,
  getDefaultSpecCompletedStatus,
  getEffectiveTaskStatus,
  getFiniteRecurringInstanceCount,
  getFrontmatterTags,
  getNextUncompletedOccurrence,
  getOccurrenceMaterializationMode,
  getOccurrenceNextTrigger,
  getPriorityConfig,
  getRecurrenceDisplayText,
  getRecurringTaskActionDate,
  getRecurringTaskCompletionText,
  getStatusConfig,
  getTodayLocal,
  getTodayString,
  hasTimeComponent,
  isBeforeDateSafe,
  isCompletedStatus,
  isDueByRRule,
  isMaterializedOccurrenceTask,
  isPropertyForField,
  isRecognizedProperty,
  isSameDateSafe,
  isSkippedStatus,
  isSpecCompletedStatus,
  isValidDependencyRelType,
  lookupMappingKey,
  mapTaskFromFrontmatter,
  mapTaskToFrontmatter,
  mergeFrontmatter,
  normalizeBlockedByValue,
  normalizeDependencyEntry,
  normalizeDependencyList,
  normalizeExcludedFolders,
  normalizeFrontmatterTag,
  normalizePriorityConfigValue,
  normalizeSpecFrontmatter,
  normalizeStatusConfigValue,
  normalizeTaskPropertyValue,
  normalizeTaskReference,
  normalizeTaskUpdateDetails,
  normalizeTaskUpdateInput,
  normalizeTitleValue,
  parseDateToLocal,
  parseDateToUTC,
  parseFrontmatter,
  parseLinkToPath,
  parseTaskDocument,
  priorityConfigSchema,
  recalculateRecurringSchedule,
  recurringCompletePlanToFrontmatterPatch,
  recurringSkippedPlanToFrontmatterPatch,
  reminderSchema,
  resolveDateOrToday,
  resolveDateTimeRangeBound,
  resolveDisplayTitle,
  resolveModelConfig,
  resolveOperationTargetDate,
  serializeDependencies,
  serializeMarkdownDocument,
  serializeTaskDocument,
  shouldShowRecurringTaskOnDate,
  shouldUseRecurringTaskUI,
  specFrontmatterToTaskInfo,
  statusConfigSchema,
  stringifyFrontmatter,
  taskDependencyRelTypeSchema,
  taskDependencySchema,
  taskInfoToSpecFields,
  toUserField,
  toUserFields,
  updateDTSTARTInRecurrenceRule,
  updateToNextScheduledOccurrence,
  validateCompleteInstances,
  validateDateString,
  validateFieldMapping,
} from "@tasknotes/model";
export type {
  BuildMaterializeOccurrencePlanInput,
  BuildMaterializedOccurrenceCompletePlanInput,
  BuildMaterializedOccurrenceSkipPlanInput,
  BuildMaterializedOccurrenceUncompletePlanInput,
  BuildMaterializedOccurrenceUnskipPlanInput,
  BuildSpecCompleteTaskUpdateInput,
  BuildSpecRecurringSkipUpdateInput,
  BuildTaskPropertyUpdatePlanInput,
  BuildTaskUpdatePlanInput,
  ConformanceEnvelope,
  DateTimeRangeBound,
  FrontmatterPropertyName,
  HideIdentifyingTagsMode,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MaterializeOccurrencePlan,
  MaterializedOccurrenceStatusPlan,
  OccurrenceConfig,
  OccurrenceMaterializationMode,
  OccurrenceNextTrigger,
  ParseTaskDocumentOptions,
  PriorityConfig,
  RecurrenceAnchor,
  RecurrenceCompletionInput,
  RecurrenceCompletionResult,
  RecurrenceConfig,
  RecurrenceDateContext,
  RecurrenceScheduleInput,
  RecurrenceScheduleResult,
  RecurringTaskCompletePlan,
  RecurringTaskLike,
  RecurringTaskSkippedPlan,
  Reminder,
  SerializeTaskDocumentOptions,
  SpecTaskUpdatePlan,
  StatusConfig,
  TaskDefaults,
  TaskDependency,
  TaskDependencyRelType,
  TaskDocument,
  TaskIdentificationConfig,
  TaskNotesModelConfig,
  TaskOperationPlan,
  TaskPatchOperation,
  TaskValidationIssue,
  TaskValidationResult,
  TaskValidationSeverity,
  UserMappedField,
  UserMappedFieldType,
} from "@tasknotes/model";
import type {
  TaskInfo as ModelTaskInfo,
  TaskCreationData as ModelTaskCreationData,
  TaskUpdateInput as ModelTaskUpdateInput,
} from "@tasknotes/model";

type RetiredTaskField = "timeEstimate" | "timeEntries" | "totalTrackedTime";
export type TaskInfo = Omit<ModelTaskInfo, RetiredTaskField>;
export type TaskCreationData = Omit<ModelTaskCreationData, RetiredTaskField>;
export type TaskUpdateInput = Omit<ModelTaskUpdateInput, RetiredTaskField>;

function rejectRetiredTaskFields(
  request: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  const keys = ["timeEstimate", "timeEntries", "totalTrackedTime"].filter(
    (key) => Object.hasOwn(request, key),
  );
  if (keys.length > 0) {
    context.addIssue({ code: "unrecognized_keys", keys });
  }
}

// ---------------------------------------------------------------------------
// TaskInfo wire schema (zod v4 mirror of the model's taskInfoSchema)
// ---------------------------------------------------------------------------

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

/** Supported subset of the pinned upstream task schema. */
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
  .loose()
  .superRefine(rejectRetiredTaskFields);

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
    details: z.string().nullable().optional(),
  })
  .loose()
  .superRefine(rejectRetiredTaskFields);

export type TaskUpdateRequest = z.infer<typeof TaskUpdateRequestSchema>;

/**
 * POST /api/tasks/:id/complete-instance — upstream takes `{date?}` and
 * TOGGLES that instance. `completed` is this server's set-semantics
 * extension (P1): when present, the instance is set absolutely, which is
 * what makes the app's offline replay idempotent. `restore` is accepted only
 * while clearing a completed instance and restores the recurring schedule
 * snapshot that existed before completion advanced it.
 */
export const RecurringCompletionRestoreSchema = z.object({
  scheduled: z.string().nullable(),
  due: z.string().nullable(),
  recurrence: z.string(),
  skipped: z.boolean(),
});

export type RecurringCompletionRestore = z.infer<
  typeof RecurringCompletionRestoreSchema
>;

export const CompleteInstanceRequestSchema = z
  .object({
    // z.iso.date() rejects malformed dates (e.g. "not-a-date") at the schema
    // boundary with a 400, instead of letting `new Date(...)` produce an
    // Invalid Date that later throws RangeError out of `ymd(...).toISOString()`.
    date: z.iso.date().optional(),
    completed: z.boolean().optional(),
    restore: RecurringCompletionRestoreSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.restore !== undefined && request.completed !== false) {
      context.addIssue({
        code: "custom",
        path: ["restore"],
        message: "restore is allowed only when completed is false",
      });
    }
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

// ---------------------------------------------------------------------------
// Wikilink projects (review finding #10: "[[Projects/Foo|alias]]" written by
// Obsidian and "Foo" written by the app never matched)
// ---------------------------------------------------------------------------

const WIKILINK = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

/** The canonical vault path inside a project value ("[[A/B|C]]" → "A/B"). */
export function projectPath(value: string): string {
  const match = WIKILINK.exec(value.trim());
  return match?.[1] === undefined ? value.trim() : match[1].trim();
}

/** What a human should see ("[[A/B|C]]" → "C"; "[[A/B]]" → "B"; "X" → "X"). */
export function projectDisplayName(value: string): string {
  const match = WIKILINK.exec(value.trim());
  if (match === null) return value.trim();
  const alias = match[2]?.trim();
  if (alias !== undefined && alias.length > 0) return alias;
  const path = match[1]?.trim() ?? "";
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Whether two project values refer to the same project, tolerant of the
 * wikilink/bare-name duality. Two path-qualified values only match when their
 * canonical vault paths match; this keeps projects such as `Areas/Work` and
 * `Projects/Work` distinct even though they share a display basename.
 */
function projectKeys(value: string): Set<string> {
  const path = projectPath(value).toLowerCase();
  const lastSlash = path.lastIndexOf("/");
  return new Set([
    value.trim().toLowerCase(),
    path,
    lastSlash === -1 ? path : path.slice(lastSlash + 1),
    projectDisplayName(value).toLowerCase(),
  ]);
}

export function projectMatches(a: string, b: string): boolean {
  const pathA = projectPath(a).toLowerCase();
  const pathB = projectPath(b).toLowerCase();
  if (pathA === pathB) return true;
  if (pathA.includes("/") && pathB.includes("/")) return false;

  const ka = projectKeys(a);
  return [...projectKeys(b)].some((k) => ka.has(k));
}
