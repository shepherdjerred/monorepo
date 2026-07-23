import React, { useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import {
  EMPTY_FILTER,
  DEFAULT_SORT,
  applyFilter,
  applySort,
} from "../domain/filters";
import { projectDisplayName, projectMatches } from "tasknotes-types/v2";

import { useTaskListScreen } from "../hooks/use-task-list-screen";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";

type Props = NativeStackScreenProps<RootStackParamList, "ProjectDetail">;

export function ProjectDetailScreen({ route, navigation }: Props) {
  const { projectName } = route.params;
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
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [sort, setSort] = useState(DEFAULT_SORT);

  const projectTasks = useMemo(
    () =>
      taskList.filter((t) =>
        t.projects.some((p) => projectMatches(String(p), String(projectName))),
      ),
    [taskList, projectName],
  );

  const displayTasks = useMemo(
    () => applySort(applyFilter(projectTasks, filter), sort),
    [projectTasks, filter, sort],
  );

  React.useEffect(() => {
    navigation.setOptions({ title: projectDisplayName(String(projectName)) });
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
        onTaskSchedule={handleSchedule}
        dayCounts={dayCounts}
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
