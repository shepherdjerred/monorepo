import { z } from "zod";
import type { TaskInfo, TaskNotesModelConfig } from "tasknotes-types/v2";
import { getPriorityConfig, isCompletedStatus } from "tasknotes-types/v2";

/**
 * FilterQuery tree evaluator for POST /api/tasks/query — the upstream
 * plugin's query contract (FilterGroup/FilterCondition with and/or
 * conjunctions). Unknown properties and operators fail schema validation,
 * which the route layer turns into a 400 (review finding #13: the old
 * server silently stripped unknown keys and matched everything).
 *
 * Upstream's controller flattens grouped results into one array, so
 * `groupKey` affects nothing observable over HTTP; sorting is honored.
 */

const FilterPropertySchema = z.union([
  z.enum([
    "title",
    "path",
    "status",
    "priority",
    "tags",
    "contexts",
    "projects",
    "blockedBy",
    "blocking",
    "due",
    "scheduled",
    "completedDate",
    "dateCreated",
    "dateModified",
    "archived",
    "hasSubtasks",
    "dependencies.isBlocked",
    "dependencies.isBlocking",
    "timeEstimate",
    "recurrence",
    "status.isCompleted",
  ]),
  z.templateLiteral(["user:", z.string()]),
]);

const FilterOperatorSchema = z.enum([
  "is",
  "is-not",
  "contains",
  "does-not-contain",
  "is-before",
  "is-after",
  "is-on-or-before",
  "is-on-or-after",
  "is-empty",
  "is-not-empty",
  "is-checked",
  "is-not-checked",
  "is-greater-than",
  "is-less-than",
  "is-greater-than-or-equal",
  "is-less-than-or-equal",
]);

const FilterValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.number(),
  z.boolean(),
  z.null(),
]);

const FilterConditionSchema = z.object({
  type: z.literal("condition"),
  id: z.string(),
  property: FilterPropertySchema,
  operator: FilterOperatorSchema,
  value: FilterValueSchema,
});

type FilterCondition = z.infer<typeof FilterConditionSchema>;

type FilterGroup = {
  type: "group";
  id: string;
  conjunction: "and" | "or";
  children: (FilterCondition | FilterGroup)[];
};

const FilterGroupSchema: z.ZodType<FilterGroup> = z.object({
  type: z.literal("group"),
  id: z.string(),
  conjunction: z.enum(["and", "or"]),
  get children() {
    return z.array(z.union([FilterConditionSchema, FilterGroupSchema]));
  },
});

export const FilterQuerySchema = z
  .object({
    type: z.literal("group"),
    id: z.string(),
    conjunction: z.enum(["and", "or"]),
    get children() {
      return z.array(z.union([FilterConditionSchema, FilterGroupSchema]));
    },
    sortKey: z.string().optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    groupKey: z.string().optional(),
    subgroupKey: z.string().optional(),
  })
  .loose();

export type FilterQuery = z.infer<typeof FilterQuerySchema>;

export function evaluateQuery(
  query: FilterQuery,
  tasks: readonly TaskInfo[],
  config: TaskNotesModelConfig,
): TaskInfo[] {
  const matched = tasks.filter((task) =>
    evaluateGroup(
      {
        type: "group",
        id: query.id,
        conjunction: query.conjunction,
        children: query.children,
      },
      task,
      config,
    ),
  );
  return sortTasks(matched, query.sortKey, query.sortDirection, config);
}

function evaluateGroup(
  group: FilterGroup,
  task: TaskInfo,
  config: TaskNotesModelConfig,
): boolean {
  if (group.children.length === 0) return true;
  const results = group.children.map((child) =>
    child.type === "group"
      ? evaluateGroup(child, task, config)
      : evaluateCondition(child, task, config),
  );
  return group.conjunction === "and"
    ? results.every(Boolean)
    : results.some(Boolean);
}

function propertyValue(
  property: string,
  task: TaskInfo,
  config: TaskNotesModelConfig,
): unknown {
  switch (property) {
    case "status.isCompleted":
      return isCompletedStatus(task.status, config.statuses);
    case "dependencies.isBlocked":
      return task.isBlocked ?? false;
    case "dependencies.isBlocking":
      return task.isBlocking ?? false;
    case "blockedBy":
      return (task.blockedBy ?? []).map((d) => d.uid);
    default: {
      const direct = DirectPropertySchema.safeParse(property);
      if (direct.success) return task[direct.data];
      // user:<key> — user-mapped fields surface in customProperties.
      const key = property.slice("user:".length);
      return task.customProperties?.[key];
    }
  }
}

const DirectPropertySchema = z.enum([
  "title",
  "path",
  "status",
  "priority",
  "tags",
  "contexts",
  "projects",
  "blocking",
  "due",
  "scheduled",
  "completedDate",
  "dateCreated",
  "dateModified",
  "archived",
  "hasSubtasks",
  "timeEstimate",
  "recurrence",
]);

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function scalarToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => scalarToString(v));
  if (value === undefined || value === null) return [];
  return [scalarToString(value)];
}

/** Compare on the date part only, lexically — dates are ISO strings. */
function datePart(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  return value.slice(0, 10);
}

function matchesIs(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return asStrings(expected).every((v) => asStrings(actual).includes(v));
  }
  return asStrings(actual)[0] === asStrings(expected)[0];
}

function matchesContains(actual: unknown, expected: unknown): boolean {
  const needle = scalarToString(expected).toLowerCase();
  return asStrings(actual).some((v) => v.toLowerCase().includes(needle));
}

function compareDates(
  operator: "is-before" | "is-after" | "is-on-or-before" | "is-on-or-after",
  actual: unknown,
  expected: unknown,
): boolean {
  const a = datePart(actual);
  const b = datePart(expected);
  if (a === null || b === null) return false;
  switch (operator) {
    case "is-before":
      return a < b;
    case "is-after":
      return a > b;
    case "is-on-or-before":
      return a <= b;
    case "is-on-or-after":
      return a >= b;
  }
}

function compareNumbers(
  operator:
    | "is-greater-than"
    | "is-less-than"
    | "is-greater-than-or-equal"
    | "is-less-than-or-equal",
  actual: unknown,
  expected: unknown,
): boolean {
  if (typeof actual !== "number") return false;
  const bound = Number(expected);
  switch (operator) {
    case "is-greater-than":
      return actual > bound;
    case "is-less-than":
      return actual < bound;
    case "is-greater-than-or-equal":
      return actual >= bound;
    case "is-less-than-or-equal":
      return actual <= bound;
  }
}

function evaluateCondition(
  condition: FilterCondition,
  task: TaskInfo,
  config: TaskNotesModelConfig,
): boolean {
  const actual = propertyValue(condition.property, task, config);
  const expected = condition.value;

  switch (condition.operator) {
    case "is":
      return matchesIs(actual, expected);
    case "is-not":
      return !matchesIs(actual, expected);
    case "contains":
      return matchesContains(actual, expected);
    case "does-not-contain":
      return !matchesContains(actual, expected);
    case "is-before":
    case "is-after":
    case "is-on-or-before":
    case "is-on-or-after":
      return compareDates(condition.operator, actual, expected);
    case "is-empty":
      return isEmptyValue(actual);
    case "is-not-empty":
      return !isEmptyValue(actual);
    case "is-checked":
      return actual === true;
    case "is-not-checked":
      return actual !== true;
    case "is-greater-than":
    case "is-less-than":
    case "is-greater-than-or-equal":
    case "is-less-than-or-equal":
      return compareNumbers(condition.operator, actual, expected);
  }
}

function sortTasks(
  tasks: TaskInfo[],
  sortKey: string | undefined,
  direction: "asc" | "desc" | undefined,
  config: TaskNotesModelConfig,
): TaskInfo[] {
  if (sortKey === undefined) return tasks;
  const key = sortKey;
  const dir = direction === "desc" ? -1 : 1;

  function rank(task: TaskInfo): string | number | undefined {
    if (key === "priority") {
      return getPriorityConfig(task.priority, config.priorities)?.weight;
    }
    switch (key) {
      case "title":
        return task.title.toLowerCase();
      case "due":
        return task.due;
      case "scheduled":
        return task.scheduled;
      case "dateCreated":
        return task.dateCreated;
      case "dateModified":
        return task.dateModified;
      default:
        return undefined;
    }
  }

  return [...tasks].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1; // undefined sorts last either direction
    if (rb === undefined) return -1;
    if (ra < rb) return -1 * dir;
    if (ra > rb) return 1 * dir;
    return 0;
  });
}
