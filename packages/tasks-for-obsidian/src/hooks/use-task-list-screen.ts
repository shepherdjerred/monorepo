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
import { useTasks } from "./use-tasks";
import { showResultError } from "../lib/errors";
import { feedbackTaskComplete, feedbackTaskDelete } from "../lib/feedback";

// One aggregated alert per bulk action — per-task alerts would stack N deep.
function alertBulkFailures(
  title: string,
  results: readonly { ok: boolean }[],
  total: number,
): void {
  const failed = results.filter((r) => !r.ok).length;
  if (failed === 0) return;
  Alert.alert(
    title,
    `${String(failed)} of ${String(total)} task${total === 1 ? "" : "s"} could not be updated. They may have been renamed or deleted in Obsidian.`,
  );
}

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
    (id: TaskId) => {
      void (async () => {
        const result = await tasks.toggleTask(id);
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
    (ids: readonly TaskId[]) => {
      feedbackTaskComplete();
      void (async () => {
        const targets = ids.filter((id) => {
          const task = tasks.getTask(id);
          if (!task) return false;
          const day = isRecurring(task)
            ? completionTargetDate(task)
            : localTodayYmd();
          return !isCompletedOn(task, day);
        });
        const results = await Promise.all(
          targets.map((id) => tasks.toggleTask(id)),
        );
        alertBulkFailures("Complete Failed", results, targets.length);
      })();
    },
    [tasks.getTask, tasks.toggleTask],
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
                alertBulkFailures("Delete Failed", results, ids.length);
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
        alertBulkFailures("Reschedule Failed", results, ids.length);
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
        alertBulkFailures("Priority Failed", results, ids.length);
      })();
    },
    [tasks.updateTask],
  );

  return {
    ...tasks,
    handlePress,
    handleToggle,
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
