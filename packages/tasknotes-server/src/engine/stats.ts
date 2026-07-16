import type { TaskInfo, TaskNotesModelConfig } from "tasknotes-types/v2";
import { isCompletedStatus } from "tasknotes-types/v2";

/**
 * GET /api/stats and GET /api/filter-options, computed against the user's
 * CONFIGURED workflow (review finding #9: the old server hardcoded
 * open/done semantics; upstream derives completion from StatusConfig and
 * returns config OBJECTS in filter-options, not bare strings).
 */

export type Stats = {
  total: number;
  completed: number;
  active: number;
  overdue: number;
  archived: number;
  withTimeTracking: number;
};

export function computeStats(
  tasks: readonly TaskInfo[],
  config: TaskNotesModelConfig,
  today: string,
): Stats {
  let completed = 0;
  let active = 0;
  let overdue = 0;
  let archived = 0;
  let withTimeTracking = 0;
  for (const task of tasks) {
    const isDone = isCompletedStatus(task.status, config.statuses);
    if (task.archived) archived += 1;
    if (isDone) completed += 1;
    else if (!task.archived) {
      active += 1;
      const due = task.due?.slice(0, 10);
      if (due !== undefined && due < today) overdue += 1;
    }
    if ((task.timeEntries ?? []).length > 0) withTimeTracking += 1;
  }
  return {
    total: tasks.length,
    completed,
    active,
    overdue,
    archived,
    withTimeTracking,
  };
}

export type FilterOptions = {
  statuses: TaskNotesModelConfig["statuses"];
  priorities: TaskNotesModelConfig["priorities"];
  contexts: string[];
  projects: string[];
  tags: string[];
  folders: string[];
};

export function computeFilterOptions(
  tasks: readonly TaskInfo[],
  config: TaskNotesModelConfig,
): FilterOptions {
  const contexts = new Set<string>();
  const projects = new Set<string>();
  const tags = new Set<string>();
  const folders = new Set<string>();
  for (const task of tasks) {
    for (const c of task.contexts ?? []) contexts.add(c);
    for (const p of task.projects ?? []) projects.add(p);
    for (const t of task.tags ?? []) tags.add(t);
    const dir = task.path.includes("/")
      ? task.path.slice(0, task.path.lastIndexOf("/"))
      : "";
    folders.add(dir);
  }
  return {
    statuses: config.statuses,
    priorities: config.priorities,
    contexts: [...contexts].sort(),
    projects: [...projects].sort(),
    tags: [...tags].sort(),
    folders: [...folders].sort(),
  };
}
