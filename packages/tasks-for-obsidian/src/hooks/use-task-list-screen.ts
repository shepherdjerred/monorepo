import { useCallback } from "react";
import { Alert } from "react-native";

import type { TaskId } from "../domain/types";
import type { Priority } from "../domain/priority";
import type { ScheduleField } from "../components/input/ScheduleSheet";
import {
  completionTargetDate,
  isCompletedOn,
  isRecurring,
  localTodayYmd,
} from "../domain/recurrence";
import { isCompletedStatus } from "../domain/status";
import { useTasks } from "./use-tasks";
import { showBulkResultErrors, showResultError } from "../lib/errors";
import { feedbackTaskComplete, feedbackTaskDelete } from "../lib/feedback";

type NavigateFn = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function useTaskListScreen(navigation: NavigateFn) {
  const tasks = useTasks();

  const handlePress = useCallback(
    (id: TaskId) => {
      navigation.navigate("TaskDetail", { taskId: id });
    },
    [navigation],
  );

  const handleToggle = useCallback(
    (id: TaskId, occurrenceDate?: string) => {
      void (async () => {
        const task = tasks.getTask(id);
        const globallyCompletedRecurring =
          task !== null && isRecurring(task) && isCompletedStatus(task.status);
        const result = globallyCompletedRecurring
          ? await tasks.toggleTask(id, { scope: "task-status" })
          : occurrenceDate === undefined
            ? await tasks.toggleTask(id)
            : await tasks.toggleTask(id, { occurrenceDate });
        showResultError(result, "Toggle Failed");
      })();
    },
    [tasks.getTask, tasks.toggleTask],
  );

  const handleStatusToggle = useCallback(
    (id: TaskId) => {
      void (async () => {
        const result = await tasks.toggleTask(id, { scope: "task-status" });
        showResultError(result, "Toggle Failed");
      })();
    },
    [tasks.toggleTask],
  );

  const handleDelete = useCallback(
    (id: TaskId) => {
      Alert.alert("Delete Task", "Are you sure you want to delete this task?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            feedbackTaskDelete();
            void tasks.deleteTask(id);
          },
        },
      ]);
    },
    [tasks.deleteTask],
  );

  const handleRefresh = useCallback(() => {
    void tasks.refresh();
  }, [tasks.refresh]);

  const handleSchedule = useCallback(
    (id: TaskId, field: ScheduleField, value: string | null) => {
      void (async () => {
        const result = await tasks.updateTask(
          id,
          field === "due" ? { due: value } : { scheduled: value },
        );
        showResultError(result, "Reschedule Failed");
      })();
    },
    [tasks.updateTask],
  );

  const handleFabPress = useCallback(() => {
    navigation.navigate("QuickAdd");
  }, [navigation]);

  // Bulk actions over a selection. One feedback cue per action, not per
  // task; the single-flight SyncEngine coalesces the N dispatches into one
  // drain pass.
  const handleBulkComplete = useCallback(
    (
      ids: readonly TaskId[],
      completionDateByTaskId?: ReadonlyMap<TaskId, string>,
    ) => {
      feedbackTaskComplete();
      void (async () => {
        const targets = ids.filter((id) => {
          const task = tasks.getTask(id);
          if (!task) return false;
          const day = isRecurring(task)
            ? (completionDateByTaskId?.get(id) ?? completionTargetDate(task))
            : localTodayYmd();
          return !isCompletedOn(task, day);
        });
        const results = await tasks.completeTasks(
          targets,
          completionDateByTaskId,
        );
        showBulkResultErrors(results, targets.length, "Complete Failed");
      })();
    },
    [tasks.completeTasks, tasks.getTask],
  );

  const handleBulkDelete = useCallback(
    (ids: readonly TaskId[], onDeleted?: () => void) => {
      Alert.alert(
        "Delete Tasks",
        `Delete ${String(ids.length)} task${ids.length === 1 ? "" : "s"}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              feedbackTaskDelete();
              void (async () => {
                const results = await Promise.all(
                  ids.map((id) => tasks.deleteTask(id)),
                );
                showBulkResultErrors(results, ids.length, "Delete Failed");
              })();
              onDeleted?.();
            },
          },
        ],
      );
    },
    [tasks.deleteTask],
  );

  const handleBulkSchedule = useCallback(
    (ids: readonly TaskId[], field: ScheduleField, value: string | null) => {
      void (async () => {
        const results = await Promise.all(
          ids.map((id) =>
            tasks.updateTask(
              id,
              field === "due" ? { due: value } : { scheduled: value },
            ),
          ),
        );
        showBulkResultErrors(results, ids.length, "Reschedule Failed");
      })();
    },
    [tasks.updateTask],
  );

  const handleBulkPriority = useCallback(
    (ids: readonly TaskId[], priority: Priority) => {
      void (async () => {
        const results = await Promise.all(
          ids.map((id) => tasks.updateTask(id, { priority })),
        );
        showBulkResultErrors(results, ids.length, "Priority Failed");
      })();
    },
    [tasks.updateTask],
  );

  return {
    ...tasks,
    handlePress,
    handleToggle,
    handleStatusToggle,
    handleDelete,
    handleRefresh,
    handleSchedule,
    handleFabPress,
    handleBulkComplete,
    handleBulkDelete,
    handleBulkSchedule,
    handleBulkPriority,
  };
}
