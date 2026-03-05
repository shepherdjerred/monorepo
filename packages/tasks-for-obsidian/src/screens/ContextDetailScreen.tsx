import React, { useCallback, useMemo, useState } from "react";
import { View, Alert, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { TaskId } from "../domain/types";
import type { RootStackParamList } from "../navigation/types";
import {
  type FilterConfig,
  type SortConfig,
  EMPTY_FILTER,
  DEFAULT_SORT,
  applyFilter,
  applySort,
} from "../domain/filters";
import { useTasks } from "../hooks/use-tasks";
import { showResultError } from "../lib/errors";
import { feedbackTaskDelete } from "../lib/feedback";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";

type Props = NativeStackScreenProps<RootStackParamList, "ContextDetail">;

export function ContextDetailScreen({ route, navigation }: Props) {
  const { contextName } = route.params;
  const {
    taskList,
    toggleTask,
    deleteTask,
    projectNames,
    contextNames,
    tagNames,
  } = useTasks();
  const [filter, setFilter] = useState<FilterConfig>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

  const contextTasks = useMemo(
    () => taskList.filter((t) => t.contexts.includes(contextName)),
    [taskList, contextName],
  );

  const displayTasks = useMemo(
    () => applySort(applyFilter(contextTasks, filter), sort),
    [contextTasks, filter, sort],
  );

  const handlePress = useCallback(
    (id: TaskId) => {
      navigation.navigate("TaskDetail", { taskId: id });
    },
    [navigation],
  );

  const handleToggle = useCallback(
    (id: TaskId) => {
      void (async () => {
        const result = await toggleTask(id);
        showResultError(result, "Toggle Failed");
      })();
    },
    [toggleTask],
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
            void deleteTask(id);
          },
        },
      ]);
    },
    [deleteTask],
  );

  React.useEffect(() => {
    navigation.setOptions({ title: `@${String(contextName)}` });
  }, [navigation, contextName]);

  return (
    <View style={styles.container}>
      <FilterSortBar
        filter={filter}
        sort={sort}
        onFilterChange={setFilter}
        onSortChange={setSort}
        availableProjects={projectNames}
        availableContexts={contextNames}
        availableTags={tagNames}
      />
      <TaskList
        tasks={displayTasks}
        onTaskPress={handlePress}
        onTaskToggle={handleToggle}
        onTaskDelete={handleDelete}
        emptyTitle="No tasks in this context"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
