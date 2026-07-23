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
      void tasks.updateTask(
        id,
        field === "due" ? { due: value } : { scheduled: value },
      );
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
      for (const id of ids) {
        const task = tasks.getTask(id);
        if (!task) continue;
        const day = isRecurring(task)
          ? completionTargetDate(task)
          : localTodayYmd();
        if (isCompletedOn(task, day)) continue;
        void tasks.toggleTask(id);
      }
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
              for (const id of ids) void tasks.deleteTask(id);
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
      for (const id of ids) {
        void tasks.updateTask(
          id,
          field === "due" ? { due: value } : { scheduled: value },
        );
      }
    },
    [tasks.updateTask],
  );

  const handleBulkPriority = useCallback(
    (ids: readonly TaskId[], priority: Priority) => {
      for (const id of ids) {
        void tasks.updateTask(id, { priority });
      }
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
