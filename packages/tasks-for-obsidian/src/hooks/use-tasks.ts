import { useCallback, useMemo, useState } from "react";

import type { TaskId } from "../domain/types";
import { isActiveStatus } from "../domain/status";
import {
  completionTargetDate,
  isRecurring,
  localTodayYmd,
  nextOccurrenceAfter,
  occursOn,
} from "../domain/recurrence";
import { useUndo } from "../state/UndoContext";
import { feedbackTaskUncomplete } from "../lib/feedback";
import { formatDate } from "../lib/dates";
import { projectDisplayName, projectPath } from "tasknotes-types/v2";
import { isOverdue, isToday, isUpcoming } from "../lib/dates";
import { useTaskContext } from "../state/TaskContext";

export function useTasks() {
  const ctx = useTaskContext();
  const { showUndo } = useUndo();
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
      // stays visible when checked so completion feedback is felt. The
      // active-status guard still applies: a globally done/cancelled
      // recurring task must not reappear each time its rrule fires
      // (checking off today's instance mutates completeInstances, not
      // status, so a live recurring task stays visible).
      if (isRecurring(t)) return isActiveStatus(t.status) && occursOn(t, today);
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
        if (isRecurring(t))
          return (
            isActiveStatus(t.status) && horizon.some((day) => occursOn(t, day))
          );
        return (
          isActiveStatus(t.status) &&
          isUpcoming(t.due, Number.POSITIVE_INFINITY)
        );
      })
      .sort((a, b) => {
        // Recurring tasks surface via occursOn and are often scheduled-only
        // (no due), so key on scheduled ?? due to keep calendar order.
        const aKey = a.scheduled ?? a.due;
        const bKey = b.scheduled ?? b.due;
        if (!aKey || !bKey) return 0;
        return new Date(aKey).getTime() - new Date(bKey).getTime();
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

  // Active-task count per YYYY-MM-DD (due + scheduled), for the schedule
  // sheet's calendar dots — a glanceable per-day load indicator.
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of taskList) {
      if (!isActiveStatus(t.status)) continue;
      const days = new Set<string>();
      if (t.due) days.add(t.due.slice(0, 10));
      if (t.scheduled) days.add(t.scheduled.slice(0, 10));
      for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return counts;
  }, [taskList]);

  // Completing a recurring task offers a transient Undo: the occurrence
  // date it targets is invisible in the UI and the server may advance
  // `scheduled` on completion, so this is the one tap that's hard to
  // reverse by hand. Undo resends the SAME date with completed:false
  // (idempotent set-semantics both sides).
  const toggleTask = useCallback(
    async (id: TaskId) => {
      const task = ctx.tasks.get(ctx.resolveTaskId(id));
      const date =
        task !== undefined && isRecurring(task)
          ? completionTargetDate(task)
          : undefined;
      const completing =
        task !== undefined &&
        date !== undefined &&
        !task.completeInstances.includes(date);
      const result = await ctx.toggleStatus(id);
      if (result.ok && task !== undefined && date !== undefined && completing) {
        const next = nextOccurrenceAfter(task, date);
        showUndo({
          message: next ? `Completed · Next: ${formatDate(next)}` : "Completed",
          onUndo: () => {
            feedbackTaskUncomplete();
            void ctx.setInstanceComplete(id, date, false);
          },
        });
      }
      return result;
    },
    [ctx, showUndo],
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
    contextNames,
    dayCounts,
    toggleTask,
    getTask,
    refresh,
    refreshing,
  };
}
