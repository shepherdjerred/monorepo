import { useCallback } from "react";
import { Alert } from "react-native";

import type { TaskId } from "../domain/types";
import { useTasks } from "./use-tasks";
import { feedbackTaskDelete } from "../lib/feedback";

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
      void tasks.toggleTask(id);
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

  const handleFabPress = useCallback(() => {
    navigation.navigate("QuickAdd");
  }, [navigation]);

  return {
    ...tasks,
    handlePress,
    handleToggle,
    handleDelete,
    handleRefresh,
    handleFabPress,
  };
}
