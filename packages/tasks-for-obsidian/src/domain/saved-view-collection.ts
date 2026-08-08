import { projectDisplayName, projectMatches } from "tasknotes-types/v2";

import { comparePriority, PRIORITY_LABELS } from "./priority";
import type { Task } from "./types";
import { isActiveStatus, isCompletedStatus, STATUS_LABELS } from "./status";
import type {
  RelativeDayRange,
  SavedView,
  SavedViewGroupSchema,
  SavedViewQuery,
  SavedViewSortSchema,
} from "./saved-views";
import type { z } from "zod";
import { parseLocalDate, toISODate } from "../lib/dates";

type SavedViewSort = z.infer<typeof SavedViewSortSchema>;
type SavedViewGroup = z.infer<typeof SavedViewGroupSchema>;

function dateOnly(value: string, field: string): Date {
  const parsed = parseLocalDate(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError(`Invalid ${field} date: ${value}`);
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function dayNumber(value: string, field: string): number {
  const date = dateOnly(value, field);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function isWithinRelativeRange(
  value: string | undefined,
  range: RelativeDayRange | undefined,
  referenceDay: string,
  field: string,
): boolean {
  if (range === undefined) return true;
  if (value === undefined) return false;

  const offset = Math.round(
    (dayNumber(value, field) - dayNumber(referenceDay, "reference")) /
      (24 * 60 * 60 * 1000),
  );
  if (range.startOffsetDays !== undefined && offset < range.startOffsetDays) {
    return false;
  }
  if (range.endOffsetDays !== undefined && offset > range.endOffsetDays) {
    return false;
  }
  return true;
}

function hasMissingField(
  task: Task,
  field: SavedViewQuery["missingFields"][number],
): boolean {
  switch (field) {
    case "project":
      return task.projects.length === 0;
    case "context":
      return task.contexts.length === 0;
    case "tag":
      return task.tags.length === 0;
    case "scheduled":
      return task.scheduled === undefined;
    case "deadline":
      return task.due === undefined;
    case "recurrence":
      return task.recurrence === undefined;
    case "estimate":
      return task.timeEstimate === undefined;
  }
}

function matchesCompletion(task: Task, query: SavedViewQuery): boolean {
  switch (query.completed) {
    case "active":
      return isActiveStatus(task.status);
    case "completed":
      return isCompletedStatus(task.status);
    case "all":
      return true;
  }
}

function matchesText(task: Task, text: string | undefined): boolean {
  if (text === undefined) return true;
  const needle = text.toLocaleLowerCase();
  return [
    task.title,
    task.details ?? "",
    ...task.projects.map(String),
    ...task.contexts.map(String),
    ...task.tags.map(String),
  ].some((value) => value.toLocaleLowerCase().includes(needle));
}

export function filterTasksForSavedView(
  tasks: readonly Task[],
  query: SavedViewQuery,
  referenceDay: string,
): Task[] {
  dateOnly(referenceDay, "reference");

  return tasks.filter((task) => {
    if (!matchesCompletion(task, query)) return false;
    if (
      query.projects.length > 0 &&
      !task.projects.some((project) =>
        query.projects.some((wanted) =>
          projectMatches(String(project), wanted),
        ),
      )
    ) {
      return false;
    }
    if (
      query.contexts.length > 0 &&
      !task.contexts.some((context) => query.contexts.includes(String(context)))
    ) {
      return false;
    }
    if (
      query.tags.length > 0 &&
      !task.tags.some((tag) => query.tags.includes(String(tag)))
    ) {
      return false;
    }
    if (query.statuses.length > 0 && !query.statuses.includes(task.status)) {
      return false;
    }
    if (
      query.priorities.length > 0 &&
      !query.priorities.includes(task.priority)
    ) {
      return false;
    }
    if (!matchesText(task, query.text)) return false;
    if (query.missingFields.some((field) => !hasMissingField(task, field))) {
      return false;
    }
    if (
      !isWithinRelativeRange(
        task.scheduled,
        query.scheduled,
        referenceDay,
        "scheduled",
      )
    ) {
      return false;
    }
    return isWithinRelativeRange(
      task.due,
      query.deadline,
      referenceDay,
      "deadline",
    );
  });
}

function compareOptionalStrings(
  a: string | undefined,
  b: string | undefined,
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a.localeCompare(b);
}

function compareBySortField(a: Task, b: Task, sort: SavedViewSort): number {
  switch (sort.field) {
    case "scheduled":
      return compareOptionalStrings(a.scheduled, b.scheduled);
    case "deadline":
      return compareOptionalStrings(a.due, b.due);
    case "priority":
      return comparePriority(a.priority, b.priority);
    case "title":
      return a.title.localeCompare(b.title);
    case "created":
      return compareOptionalStrings(a.dateCreated, b.dateCreated);
    case "completed":
      return compareOptionalStrings(a.completedDate, b.completedDate);
  }
}

export function sortTasksForSavedView(
  tasks: readonly Task[],
  sort: SavedViewSort,
): Task[] {
  const direction = sort.direction === "ascending" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const compared = compareBySortField(a, b, sort);
    if (compared !== 0) return direction * compared;
    return (
      a.title.localeCompare(b.title) || String(a.id).localeCompare(String(b.id))
    );
  });
}

export function deriveSavedViewTasks(
  tasks: readonly Task[],
  view: SavedView,
  referenceDay: string,
): Task[] {
  return sortTasksForSavedView(
    filterTasksForSavedView(tasks, view.query, referenceDay),
    view.presentation.sort,
  );
}

function firstValue(values: readonly string[], empty: string): string {
  return values[0] ?? empty;
}

export function savedViewGroupLabel(task: Task, group: SavedViewGroup): string {
  switch (group) {
    case "none":
      return "";
    case "scheduled":
      return task.scheduled === undefined
        ? "No Planned Date"
        : `Planned · ${toISODate(dateOnly(task.scheduled, "scheduled"))}`;
    case "deadline":
      return task.due === undefined
        ? "No Deadline"
        : `Deadline · ${toISODate(dateOnly(task.due, "deadline"))}`;
    case "project":
      return firstValue(
        task.projects.map((project) => projectDisplayName(String(project))),
        "No Project",
      );
    case "context":
      return firstValue(
        task.contexts.map((context) => `@${String(context)}`),
        "No Context",
      );
    case "tag":
      return firstValue(
        task.tags.map((tag) => `#${String(tag)}`),
        "No Tag",
      );
    case "status":
      return STATUS_LABELS[task.status];
    case "priority":
      return PRIORITY_LABELS[task.priority];
  }
}
