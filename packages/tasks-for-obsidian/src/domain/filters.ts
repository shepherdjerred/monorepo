import type { Task } from "./types";
import type { TaskStatus } from "./status";
import type { Priority } from "./priority";
import { comparePriority } from "./priority";

export type SortField = "dueDate" | "priority" | "title";
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
      !task.projects.some((p) => projects.includes(String(p)))
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

  return [...tasks].toSorted((a, b) => {
    switch (sort.field) {
      case "dueDate": {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return dir * (new Date(a.due).getTime() - new Date(b.due).getTime());
      }
      case "priority":
        return dir * comparePriority(a.priority, b.priority);
      case "title":
        return dir * a.title.localeCompare(b.title);
    }
  });
}

export const EMPTY_FILTER: FilterConfig = {};
export const DEFAULT_SORT: SortConfig = { field: "dueDate", direction: "asc" };
