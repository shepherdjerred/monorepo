import { useCallback, useMemo, useState } from "react";

import type { TaskId } from "../domain/types";
import { isActiveStatus } from "../domain/status";
import { localTodayYmd, nextOccurrenceAfter } from "../domain/recurrence";
import {
  deriveAgendaDayCounts,
  deriveTodayAgenda,
  deriveUpcomingAgenda,
} from "../domain/agenda";
import type { AgendaDateKind } from "../domain/agenda";
import { executeTaskToggle } from "../domain/task-toggle";
import { findTaskByResolvedId } from "../domain/task-lookup";
import { deriveProjectOptions } from "../domain/project-options";
import { useUndo } from "../state/UndoContext";
import { feedbackTaskUncomplete } from "../lib/feedback";
import { formatDate } from "../lib/dates";
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

  const today = localTodayYmd();
  const todayAgenda = useMemo(
    () => deriveTodayAgenda(taskList, today),
    [taskList, today],
  );
  const todayTasks = useMemo(
    () =>
      todayAgenda.flatMap((section) =>
        section.entries.map((entry) => entry.task),
      ),
    [todayAgenda],
  );
  const todaySectionByTaskId = useMemo(() => {
    const sections = new Map<TaskId, string>();
    for (const section of todayAgenda) {
      for (const entry of section.entries) {
        sections.set(entry.task.id, section.title);
      }
    }
    return sections;
  }, [todayAgenda]);

  const todayDateContextByTaskId = useMemo(() => {
    const dates = new Map<
      TaskId,
      { readonly kind: AgendaDateKind; readonly date: string }
    >();
    for (const section of todayAgenda) {
      for (const entry of section.entries) {
        dates.set(entry.task.id, {
          kind: entry.primaryKind,
          date: entry.day,
        });
      }
    }
    return dates;
  }, [todayAgenda]);
  const todayCompletionDateByTaskId = useMemo(() => {
    const dates = new Map<TaskId, string>();
    for (const section of todayAgenda) {
      for (const entry of section.entries) {
        if (entry.completionDay !== undefined) {
          dates.set(entry.task.id, entry.completionDay);
        }
      }
    }
    return dates;
  }, [todayAgenda]);

  const upcomingAgenda = useMemo(
    () => deriveUpcomingAgenda(taskList, today),
    [taskList, today],
  );
  const upcomingTasks = useMemo(
    () =>
      upcomingAgenda.flatMap((section) =>
        section.entries.map((entry) => entry.task),
      ),
    [upcomingAgenda],
  );
  const upcomingDayByTaskId = useMemo(() => {
    const days = new Map<TaskId, string>();
    for (const section of upcomingAgenda) {
      for (const entry of section.entries) {
        days.set(entry.task.id, section.day);
      }
    }
    return days;
  }, [upcomingAgenda]);

  const upcomingDateContextByTaskId = useMemo(() => {
    const dates = new Map<
      TaskId,
      { readonly kind: AgendaDateKind; readonly date: string }
    >();
    for (const section of upcomingAgenda) {
      for (const entry of section.entries) {
        dates.set(entry.task.id, {
          kind: entry.primaryKind,
          date: entry.day,
        });
      }
    }
    return dates;
  }, [upcomingAgenda]);
  const upcomingCompletionDateByTaskId = useMemo(() => {
    const dates = new Map<TaskId, string>();
    for (const section of upcomingAgenda) {
      for (const entry of section.entries) {
        if (entry.completionDay !== undefined) {
          dates.set(entry.task.id, entry.completionDay);
        }
      }
    }
    return dates;
  }, [upcomingAgenda]);

  const projectOptions = useMemo(
    () =>
      deriveProjectOptions(
        taskList.flatMap((task) => task.projects.map(String)),
      ),
    [taskList],
  );
  // Keep exact TaskNotes identities in every editor and filter. Labels are
  // derived at the presentation boundary so same-basename vault paths remain
  // independently selectable.
  const projectNames = useMemo(
    () => projectOptions.map((option) => option.identity),
    [projectOptions],
  );

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

  const dayCounts = useMemo(
    () => deriveAgendaDayCounts(taskList, today),
    [taskList, today],
  );

  const toggleTask = useCallback(
    async (
      id: TaskId,
      options?: {
        occurrenceDate?: string;
        scope?: "occurrence" | "task-status";
        suppressUndo?: boolean;
      },
    ) => {
      const task = findTaskByResolvedId(ctx.tasks, ctx.resolveTaskId, id);
      const execution = await executeTaskToggle(
        task ?? undefined,
        options?.occurrenceDate,
        options?.scope ?? "occurrence",
        {
          toggleStatus: () => ctx.toggleStatus(id),
          setInstanceComplete: (date, completed) =>
            ctx.setInstanceComplete(id, date, completed),
        },
      );
      const recurring = execution.recurring;
      if (
        recurring !== null &&
        recurring.completed &&
        recurring.restore !== null &&
        execution.result.ok &&
        options?.suppressUndo !== true
      ) {
        const restore = recurring.restore;
        const next = task ? nextOccurrenceAfter(task, recurring.date) : null;
        showUndo({
          message: next ? `Completed · Next: ${formatDate(next)}` : "Completed",
          onUndo: () => {
            feedbackTaskUncomplete();
            void ctx.setInstanceComplete(id, recurring.date, false, restore);
          },
        });
      }
      return execution.result;
    },
    [ctx, showUndo],
  );

  const getTask = useCallback(
    (id: TaskId) => findTaskByResolvedId(ctx.tasks, ctx.resolveTaskId, id),
    [ctx.resolveTaskId, ctx.tasks],
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
    todayAgenda,
    todayTasks,
    todaySectionByTaskId,
    todayDateContextByTaskId,
    todayCompletionDateByTaskId,
    upcomingAgenda,
    upcomingTasks,
    upcomingDayByTaskId,
    upcomingDateContextByTaskId,
    upcomingCompletionDateByTaskId,
    projectNames,
    projectOptions,
    tagNames,
    contextNames,
    dayCounts,
    toggleTask,
    getTask,
    refresh,
    refreshing,
  };
}
