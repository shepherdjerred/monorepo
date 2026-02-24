import { useCallback, useMemo, useState } from "react";

import type { TaskId } from "../domain/types";
import { isActiveStatus } from "../domain/status";
import { useTaskContext } from "../state/TaskContext";

function isToday(dateStr?: string): boolean {
  if (!dateStr) return false;
  const today = new Date();
  const date = new Date(dateStr);
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  return date < today;
}

function isUpcoming(dateStr?: string): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  return date > today;
}

export function useTasks() {
  const ctx = useTaskContext();
  const [refreshing, setRefreshing] = useState(false);

  const taskList = useMemo(() => [...ctx.tasks.values()], [ctx.tasks]);

  const inboxTasks = useMemo(
    () => taskList.filter((t) => t.projects.length === 0 && isActiveStatus(t.status)),
    [taskList],
  );

  const todayTasks = useMemo(
    () => taskList.filter((t) => isActiveStatus(t.status) && (isToday(t.due) || isOverdue(t.due))),
    [taskList],
  );

  const upcomingTasks = useMemo(
    () =>
      taskList
        .filter((t) => isActiveStatus(t.status) && isUpcoming(t.due))
        .sort((a, b) => {
          if (!a.due || !b.due) return 0;
          return new Date(a.due).getTime() - new Date(b.due).getTime();
        }),
    [taskList],
  );

  const projectNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of taskList) {
      for (const p of t.projects) {
        names.add(p);
      }
    }
    return [...names].sort();
  }, [taskList]);

  const tagNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of taskList) {
      for (const tag of t.tags) {
        names.add(tag);
      }
    }
    return [...names].sort();
  }, [taskList]);

  const toggleTask = useCallback(
    (id: TaskId) => ctx.toggleStatus(id),
    [ctx],
  );

  const getTask = useCallback(
    (id: TaskId) => ctx.tasks.get(id) ?? null,
    [ctx.tasks],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await ctx.refreshTasks();
    } finally {
      setRefreshing(false);
    }
  }, [ctx]);

  return {
    ...ctx,
    taskList,
    inboxTasks,
    todayTasks,
    upcomingTasks,
    projectNames,
    tagNames,
    toggleTask,
    getTask,
    refresh,
    refreshing,
  };
}
