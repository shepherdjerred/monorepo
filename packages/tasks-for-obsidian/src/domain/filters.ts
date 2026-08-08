import { projectMatches } from "tasknotes-types/v2";

import type { Task } from "./types";
import type { TaskStatus } from "./status";
import type { Priority } from "./priority";
import { comparePriority } from "./priority";

export type SortField =
  | "scheduled"
  | "dueDate"
  | "priority"
  | "title"
  | "created"
  | "completed";
export type SortDirection = "asc" | "desc";

export type SortConfig = {
  readonly field: SortField;
  readonly direction: SortDirection;
};

export type FilterConfig = {
  readonly projects?: readonly string[] | undefined;
  readonly contexts?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly statuses?: readonly TaskStatus[] | undefined;
  readonly priorities?: readonly Priority[] | undefined;
  readonly hasNoDueDate?: boolean | undefined;
};

export function isFilterActive(filter: FilterConfig): boolean {
  return (
    (filter.projects !== undefined && filter.projects.length > 0) ||
    (filter.contexts !== undefined && filter.contexts.length > 0) ||
    (filter.tags !== undefined && filter.tags.length > 0) ||
    (filter.statuses !== undefined && filter.statuses.length > 0) ||
    (filter.priorities !== undefined && filter.priorities.length > 0) ||
    filter.hasNoDueDate === true
  );
}

export function countActiveFilters(filter: FilterConfig): number {
  let count = 0;
  if (filter.projects && filter.projects.length > 0) count++;
  if (filter.contexts && filter.contexts.length > 0) count++;
  if (filter.tags && filter.tags.length > 0) count++;
  if (filter.statuses && filter.statuses.length > 0) count++;
  if (filter.priorities && filter.priorities.length > 0) count++;
  if (filter.hasNoDueDate) count++;
  return count;
}

export function applyFilter(
  tasks: readonly Task[],
  filter: FilterConfig,
): Task[] {
  return tasks.filter((task) => {
    const { projects, contexts, tags } = filter;
    if (
      projects &&
      projects.length > 0 &&
      !task.projects.some((p) =>
        projects.some((wanted) => projectMatches(String(p), wanted)),
      )
    )
      return false;
    if (
      contexts &&
      contexts.length > 0 &&
      !task.contexts.some((c) => contexts.includes(String(c)))
    )
      return false;
    if (
      tags &&
      tags.length > 0 &&
      !task.tags.some((t) => tags.includes(String(t)))
    )
      return false;
    if (
      filter.statuses &&
      filter.statuses.length > 0 &&
      !filter.statuses.includes(task.status)
    )
      return false;
    if (
      filter.priorities &&
      filter.priorities.length > 0 &&
      !filter.priorities.includes(task.priority)
    )
      return false;
    if (filter.hasNoDueDate && task.due !== undefined) return false;
    return true;
  });
}

export function applySort(tasks: readonly Task[], sort: SortConfig): Task[] {
  const dir = sort.direction === "asc" ? 1 : -1;

  return [...tasks].sort((a, b) => {
    switch (sort.field) {
      case "scheduled":
        return compareOptionalText(a.scheduled, b.scheduled, dir);
      case "dueDate": {
        return compareOptionalText(a.due, b.due, dir);
      }
      case "priority":
        return dir * comparePriority(a.priority, b.priority);
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "created":
        return compareOptionalText(a.dateCreated, b.dateCreated, dir);
      case "completed":
        return compareOptionalText(a.completedDate, b.completedDate, dir);
    }
  });
}

/**
 * Preserve a collection's semantic order until the user explicitly chooses a
 * generic sort. Agenda collections already encode date-kind precedence and
 * occurrence order, so applying DEFAULT_SORT before any interaction would
 * discard that domain ordering.
 */
export function applySortOverride(
  tasks: readonly Task[],
  sort: SortConfig | null,
): Task[] {
  return sort === null ? [...tasks] : applySort(tasks, sort);
}

function compareOptionalText(
  left: string | undefined,
  right: string | undefined,
  direction: 1 | -1,
): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return direction * left.localeCompare(right);
}

export const EMPTY_FILTER: FilterConfig = {};
export const DEFAULT_SORT: SortConfig = { field: "dueDate", direction: "asc" };
