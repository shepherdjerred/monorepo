import React, { useMemo, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { AppIcon } from "../components/common/AppIcon";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import {
  EMPTY_FILTER,
  DEFAULT_SORT,
  applyFilter,
  applySort,
} from "../domain/filters";
import { DEFAULT_SAVED_VIEWS } from "../domain/saved-views";
import { isActiveStatus } from "../domain/status";
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import { useSettings } from "../hooks/use-settings";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";

type Props = NativeStackScreenProps<RootStackParamList, "SavedView">;

export function SavedViewScreen({ route, navigation }: Props) {
  const { viewId } = route.params;
  const view = DEFAULT_SAVED_VIEWS.find((v) => v.id === viewId);
  const {
    taskList,
    projectNames,
    contextNames,
    tagNames,
    dayCounts,
    handlePress,
    handleToggle,
    handleDelete,
    handleSchedule,
  } = useTaskListScreen(navigation);
  const { colors } = useSettings();
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [sort, setSort] = useState(DEFAULT_SORT);

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
        onTaskSchedule={handleSchedule}
        dayCounts={dayCounts}
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
