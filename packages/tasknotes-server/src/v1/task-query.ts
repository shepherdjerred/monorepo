import { z } from "zod";
import { Priority, type Task } from "../protocol/generated.ts";
import type { AuthPrincipal } from "./auth-types.ts";
import { summarizePrincipal } from "./request-context.ts";
import type { FacetStore } from "./types.ts";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneParamSchema = z
  .string()
  .min(1)
  .refine((tz) => isValidTimeZone(tz), "Invalid IANA timezone");

export const TaskListQuerySchema = z.object({
  project_id: z.string().min(1).optional(),
  section_id: z.string().min(1).optional(),
  parent_id: z.string().min(1).optional(),
  label_id: z.string().min(1).optional(),
  completed: z.enum(["true", "false"]).optional(),
  include_deleted: z.enum(["true", "false"]).optional(),
  priority: z
    .enum([Priority.P1, Priority.P2, Priority.P3, Priority.P4])
    .optional(),
  due_date: z.iso.date().optional(),
  due_before: z.iso.date().optional(),
  due_on_or_before: z.iso.date().optional(),
  due_after: z.iso.date().optional(),
  due_on_or_after: z.iso.date().optional(),
  deadline_before: z.iso.date().optional(),
  deadline_after: z.iso.date().optional(),
  overdue: z.enum(["true", "false"]).optional(),
  tz: TimeZoneParamSchema.optional(),
  q: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export function civilDateInZone(instant: Date, timeZone: string): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(
    instant.getTime(),
  ).toZonedDateTimeISO(timeZone);
  return zoned.toPlainDate().toString();
}

export function effectiveTaskCivilDueDate(
  task: Task,
  fallbackZone: string,
): string | null {
  if (task.due_date !== undefined && task.due_date !== "") {
    return task.due_date;
  }
  if (task.due_datetime !== undefined && task.due_datetime !== "") {
    const dt = new Date(task.due_datetime);
    if (!Number.isNaN(dt.getTime())) {
      const zone =
        task.due_timezone !== undefined &&
        task.due_timezone !== "" &&
        isValidTimeZone(task.due_timezone)
          ? task.due_timezone
          : fallbackZone;
      return civilDateInZone(dt, zone);
    }
  }
  return null;
}

function matchesPlacementAndStatus(task: Task, query: TaskListQuery): boolean {
  if (query.section_id !== undefined) {
    const hasNoSection =
      task.section_id === undefined || task.section_id === "";
    const matchedSection =
      query.section_id === "none"
        ? hasNoSection
        : task.section_id === query.section_id;
    if (!matchedSection) {
      return false;
    }
  }
  if (query.parent_id !== undefined) {
    const hasNoParent = task.parent_id === undefined || task.parent_id === "";
    const matchedParent =
      query.parent_id === "none"
        ? hasNoParent
        : task.parent_id === query.parent_id;
    if (!matchedParent) {
      return false;
    }
  }
  return (
    (query.label_id === undefined || task.label_ids.includes(query.label_id)) &&
    (query.completed === undefined ||
      task.completed === (query.completed === "true")) &&
    (query.priority === undefined || task.priority === query.priority)
  );
}

function matchesDueBounds(
  effectiveDue: string | null,
  query: TaskListQuery,
): boolean {
  return (
    (query.due_date === undefined || effectiveDue === query.due_date) &&
    (query.due_before === undefined ||
      (effectiveDue !== null && effectiveDue < query.due_before)) &&
    (query.due_on_or_before === undefined ||
      (effectiveDue !== null && effectiveDue <= query.due_on_or_before)) &&
    (query.due_after === undefined ||
      (effectiveDue !== null && effectiveDue > query.due_after)) &&
    (query.due_on_or_after === undefined ||
      (effectiveDue !== null && effectiveDue >= query.due_on_or_after))
  );
}

function matchesDeadlineAndOverdue(
  task: Task,
  query: TaskListQuery,
  effectiveDue: string | null,
  today: string,
): boolean {
  const deadline = task.deadline ?? null;
  if (
    query.deadline_before !== undefined &&
    (deadline === null || deadline > query.deadline_before)
  ) {
    return false;
  }
  if (
    query.deadline_after !== undefined &&
    (deadline === null || deadline < query.deadline_after)
  ) {
    return false;
  }
  if (query.overdue === undefined) {
    return true;
  }
  const isOverdue =
    !task.completed && effectiveDue !== null && effectiveDue < today;
  return isOverdue === (query.overdue === "true");
}

function matchesSearchText(task: Task, query: TaskListQuery): boolean {
  const rawSearch = (query.q ?? query.search)?.trim().toLowerCase();
  return (
    rawSearch === undefined ||
    rawSearch === "" ||
    task.title.toLowerCase().includes(rawSearch) ||
    task.description.toLowerCase().includes(rawSearch) ||
    (task.comments ?? []).some((c) => c.body.toLowerCase().includes(rawSearch))
  );
}

function queryNeedsDueDate(query: TaskListQuery): boolean {
  return (
    query.due_date !== undefined ||
    query.due_before !== undefined ||
    query.due_on_or_before !== undefined ||
    query.due_after !== undefined ||
    query.due_on_or_after !== undefined ||
    query.overdue !== undefined
  );
}

export async function queryFilteredTasks(
  store: FacetStore,
  userId: string,
  query: TaskListQuery,
): Promise<Task[]> {
  const zone = query.tz ?? "UTC";
  const needsDue = queryNeedsDueDate(query);
  const today =
    query.overdue === undefined ? "" : civilDateInZone(store.getNow(), zone);
  const all = await store.listTasks({
    userId,
    projectId: query.project_id,
    includeDeleted: query.include_deleted === "true",
  });

  const filtered = all.filter((task) => {
    if (
      !matchesPlacementAndStatus(task, query) ||
      !matchesSearchText(task, query)
    ) {
      return false;
    }
    const effectiveDue = needsDue
      ? effectiveTaskCivilDueDate(task, zone)
      : null;
    return (
      matchesDueBounds(effectiveDue, query) &&
      matchesDeadlineAndOverdue(task, query, effectiveDue, today)
    );
  });

  const start = query.offset ?? 0;
  return query.limit === undefined
    ? filtered.slice(start)
    : filtered.slice(start, start + query.limit);
}

export async function buildWorkspaceSnapshot(
  store: FacetStore,
  userId: string,
  principal: AuthPrincipal,
  tz = "UTC",
) {
  const now = store.getNow();
  const today = civilDateInZone(now, tz);

  const [projects, sections, labels, filters, tasks] = await Promise.all([
    store.listProjects({ userId, includeDeleted: false }),
    store.listSections({ userId, includeDeleted: false }),
    store.listLabels({ userId, includeDeleted: false }),
    store.listFilters({ userId, includeDeleted: false }),
    store.listTasks({ userId, includeDeleted: false }),
  ]);

  let open = 0;
  let completed = 0;
  let overdue = 0;
  let dueToday = 0;

  for (const task of tasks) {
    if (task.completed) {
      completed += 1;
      continue;
    }
    open += 1;
    const due = effectiveTaskCivilDueDate(task, tz);
    if (due !== null) {
      if (due < today) {
        overdue += 1;
      } else if (due === today) {
        dueToday += 1;
      }
    }
  }

  return {
    server_time: now.toISOString(),
    today,
    timezone: tz,
    principal: summarizePrincipal(principal, userId),
    task_counts: {
      open,
      completed,
      overdue,
      due_today: dueToday,
    },
    projects,
    sections,
    labels,
    filters,
  };
}
