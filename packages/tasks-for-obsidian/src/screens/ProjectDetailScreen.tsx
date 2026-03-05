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
import { feedbackTaskDelete } from "../lib/feedback";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";

type Props = NativeStackScreenProps<RootStackParamList, "ProjectDetail">;

export function ProjectDetailScreen({ route, navigation }: Props) {
  const { projectName } = route.params;
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

  const projectTasks = useMemo(
    () => taskList.filter((t) => t.projects.includes(projectName)),
    [taskList, projectName],
  );

  const displayTasks = useMemo(
    () => applySort(applyFilter(projectTasks, filter), sort),
    [projectTasks, filter, sort],
  );

  const handlePress = useCallback(
    (id: TaskId) => {
      navigation.navigate("TaskDetail", { taskId: id });
    },
    [navigation],
  );

  const handleToggle = useCallback(
    (id: TaskId) => {
      void toggleTask(id);
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
    navigation.setOptions({ title: String(projectName) });
  }, [navigation, projectName]);

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
        emptyTitle="No tasks in this project"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
