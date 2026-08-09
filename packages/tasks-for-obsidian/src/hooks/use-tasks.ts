import { useCallback, useMemo, useState } from "react";

import type { Task, TaskId } from "../domain/types";
import type { AppError } from "../domain/errors";
import type { Result } from "../domain/result";
import { isActiveStatus } from "../domain/status";
import {
  completionTargetDate,
  localTodayYmd,
  nextOccurrenceAfter,
} from "../domain/recurrence";
import {
  deriveAgendaDayCounts,
  deriveTodayAgenda,
  deriveUpcomingAgenda,
} from "../domain/agenda";
import type { AgendaDateKind } from "../domain/agenda";
import {
  executeTaskToggle,
  successfulCompletionUndos,
  type CompletionUndo,
  type TaskToggleExecution,
} from "../domain/task-toggle";
import { findTaskByResolvedId } from "../domain/task-lookup";
import { deriveProjectOptions } from "../domain/project-options";
import { useUndo } from "../state/UndoContext";
import { feedbackTaskUncomplete } from "../lib/feedback";
import { formatDate } from "../lib/dates";
import { showBulkResultErrors, showResultError } from "../lib/errors";
import { useTaskContext } from "../state/TaskContext";

type ToggleTaskOptions = {
  readonly occurrenceDate?: string | undefined;
  readonly scope?: "occurrence" | "task-status" | undefined;
};

type ToggleTaskOutcome = {
  readonly task: Task | undefined;
  readonly execution: TaskToggleExecution<Result<Task, AppError>>;
};

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

  const executeToggle = useCallback(
    async (
      id: TaskId,
      options?: ToggleTaskOptions,
    ): Promise<ToggleTaskOutcome> => {
      const task = findTaskByResolvedId(ctx.tasks, ctx.resolveTaskId, id);
      const execution = await executeTaskToggle(
        task ?? undefined,
        options?.occurrenceDate,
        options?.scope ?? "occurrence",
        {
          toggleStatus: () => ctx.toggleStatus(id),
          setInstanceComplete: (date, completed, restore) =>
            ctx.setInstanceComplete(id, date, completed, restore),
          pendingRestore:
            task?.recurrence === undefined
              ? undefined
              : ctx.getPendingCompletionRestore(
                  id,
                  options?.occurrenceDate ?? completionTargetDate(task),
                ),
        },
      );
      return { task: task ?? undefined, execution };
    },
    [ctx],
  );

  const restoreCompletion = useCallback(
    (undo: CompletionUndo): Promise<Result<Task, AppError>> => {
      switch (undo.kind) {
        case "status":
          return ctx.setStatus(undo.taskId, undo.previousStatus);
        case "recurring-occurrence":
          return ctx.setInstanceComplete(
            undo.taskId,
            undo.date,
            false,
            undo.restore,
          );
      }
    },
    [ctx],
  );

  const pushCompletionUndo = useCallback(
    (message: string, undos: readonly CompletionUndo[]) => {
      if (undos.length === 0) return;
      showUndo({
        message,
        onUndo: async () => {
          feedbackTaskUncomplete();
          const results = await Promise.all(
            undos.map((undo) => restoreCompletion(undo)),
          );
          if (results.length === 1) {
            const result = results[0];
            if (result === undefined) {
              throw new TypeError("single completion undo requires one result");
            }
            return !showResultError(result, "Undo Failed");
          }
          return !showBulkResultErrors(results, undos.length, "Undo Failed");
        },
      });
    },
    [restoreCompletion, showUndo],
  );

  const toggleTask = useCallback(
    async (id: TaskId, options?: ToggleTaskOptions) => {
      const { task, execution } = await executeToggle(id, options);
      const undo = execution.completionUndo;
      if (undo !== null && execution.result.ok) {
        const next =
          task !== undefined && undo.kind === "recurring-occurrence"
            ? nextOccurrenceAfter(task, undo.date)
            : null;
        pushCompletionUndo(
          next ? `Completed · Next: ${formatDate(next)}` : "Completed",
          [undo],
        );
      }
      return execution.result;
    },
    [executeToggle, pushCompletionUndo],
  );

  const completeTasks = useCallback(
    async (
      ids: readonly TaskId[],
      completionDateByTaskId?: ReadonlyMap<TaskId, string>,
    ): Promise<readonly Result<Task, AppError>[]> => {
      const outcomes = await Promise.all(
        ids.map((id) => {
          const occurrenceDate = completionDateByTaskId?.get(id);
          return executeToggle(
            id,
            occurrenceDate === undefined ? undefined : { occurrenceDate },
          );
        }),
      );
      const successfulUndos = successfulCompletionUndos(
        outcomes.map(({ execution }) => execution),
      );
      if (successfulUndos.length > 0) {
        pushCompletionUndo(
          `Completed ${String(successfulUndos.length)} task${successfulUndos.length === 1 ? "" : "s"}`,
          successfulUndos,
        );
      }
      return outcomes.map(({ execution }) => execution.result);
    },
    [executeToggle, pushCompletionUndo],
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
    completeTasks,
    getTask,
    refresh,
    refreshing,
  };
}
