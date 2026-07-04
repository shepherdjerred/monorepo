import { useCallback, useMemo, useState } from "react";

import type { TaskId } from "../domain/types";
import { isActiveStatus } from "../domain/status";
import { isRecurring, localTodayYmd, occursOn } from "../domain/recurrence";
import { projectDisplayName, projectPath } from "tasknotes-types/v2";
import { parseLocalDate } from "../lib/dates";
import { useTaskContext } from "../state/TaskContext";

// Date-only strings ("YYYY-MM-DD") are parsed as LOCAL dates. new Date() would
// treat them as UTC midnight, shifting Today/Overdue/Upcoming buckets by a day
// for negative-UTC users (a task due today classifies as overdue).
function isToday(dateStr?: string): boolean {
  if (!dateStr) return false;
  const today = new Date();
  const date = parseLocalDate(dateStr);
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
  const date = parseLocalDate(dateStr);
  date.setHours(0, 0, 0, 0);
  return date < today;
}

function isUpcoming(dateStr?: string): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = parseLocalDate(dateStr);
  date.setHours(0, 0, 0, 0);
  return date > today;
}

export function useTasks() {
  const ctx = useTaskContext();
  const [refreshing, setRefreshing] = useState(false);

  // v2 lists include archived tasks (upstream parity) — filter client-side.
  const taskList = useMemo(
    () => [...ctx.tasks.values()].filter((t) => !t.archived),
    [ctx.tasks],
  );

  const inboxTasks = useMemo(
    () =>
      taskList.filter(
        (t) => t.projects.length === 0 && isActiveStatus(t.status),
      ),
    [taskList],
  );

  const todayTasks = useMemo(() => {
    const today = localTodayYmd();
    return taskList.filter((t) => {
      // Recurring: today's OCCURRENCE decides (model rrule expansion) —
      // stays visible when checked so completion feedback is felt.
      if (isRecurring(t)) return occursOn(t, today);
      return isActiveStatus(t.status) && (isToday(t.due) || isOverdue(t.due));
    });
  }, [taskList]);

  const upcomingTasks = useMemo(() => {
    const horizon: string[] = [];
    const start = new Date();
    for (let i = 1; i <= 7; i += 1) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      horizon.push(localTodayYmd(d));
    }
    return taskList
      .filter((t) => {
        if (isRecurring(t)) return horizon.some((day) => occursOn(t, day));
        return isActiveStatus(t.status) && isUpcoming(t.due);
      })
      .sort((a, b) => {
        if (!a.due || !b.due) return 0;
        return new Date(a.due).getTime() - new Date(b.due).getTime();
      });
  }, [taskList]);

  const projectNames = useMemo(() => {
    // Dedupe the wikilink/bare-name duality by canonical path; show the
    // human name. Navigation passes the display name; projectMatches
    // bridges back to every spelling.
    const byKey = new Map<string, string>();
    for (const t of taskList) {
      for (const p of t.projects) {
        const key = projectPath(String(p)).toLowerCase();
        if (!byKey.has(key)) byKey.set(key, projectDisplayName(String(p)));
      }
    }
    return [...byKey.values()].sort();
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

  const contextNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of taskList) {
      for (const c of t.contexts) {
        names.add(c);
      }
    }
    return [...names].sort();
  }, [taskList]);

  const toggleTask = useCallback((id: TaskId) => ctx.toggleStatus(id), [ctx]);

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
    contextNames,
    toggleTask,
    getTask,
    refresh,
    refreshing,
  };
}
