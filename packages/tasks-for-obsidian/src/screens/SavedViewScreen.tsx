import React, { useCallback, useMemo, useState } from "react";
import { View, Pressable, Alert, StyleSheet } from "react-native";
import { AppIcon } from "../components/common/AppIcon";
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
import { DEFAULT_SAVED_VIEWS } from "../domain/saved-views";
import { isActiveStatus } from "../domain/status";
import { useTasks } from "../hooks/use-tasks";
import { showResultError } from "../lib/errors";
import { feedbackTaskDelete } from "../lib/feedback";
import { useSettings } from "../hooks/use-settings";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";

type Props = NativeStackScreenProps<RootStackParamList, "SavedView">;

export function SavedViewScreen({ route, navigation }: Props) {
  const { viewId } = route.params;
  const view = DEFAULT_SAVED_VIEWS.find((v) => v.id === viewId);
  const {
    taskList,
    toggleTask,
    deleteTask,
    projectNames,
    contextNames,
    tagNames,
  } = useTasks();
  const { colors } = useSettings();
  const [filter, setFilter] = useState<FilterConfig>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

  React.useEffect(() => {
    if (view) {
      if (view.id === "job-search") {
        navigation.setOptions({
          title: view.name,
          headerRight: () => (
            <Pressable
              onPress={() => {
                navigation.navigate("JobSearchKanban");
              }}
              hitSlop={8}
            >
              <AppIcon name="columns" size={22} color={colors.text} />
            </Pressable>
          ),
        });
      } else {
        navigation.setOptions({ title: view.name });
      }
    }
  }, [navigation, view, colors]);

  const baseTasks = useMemo(() => {
    if (!view) return [];
    return applyFilter(
      taskList.filter((t) => isActiveStatus(t.status)),
      view.filter,
    );
  }, [taskList, view]);

  const displayTasks = useMemo(
    () => applySort(applyFilter(baseTasks, filter), sort),
    [baseTasks, filter, sort],
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

  if (!view) return null;

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
        emptyTitle={`No tasks in ${view.name}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
