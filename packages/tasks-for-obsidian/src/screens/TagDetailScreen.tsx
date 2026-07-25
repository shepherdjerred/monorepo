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
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";

type Props = NativeStackScreenProps<RootStackParamList, "TagDetail">;

export function TagDetailScreen({ route, navigation }: Props) {
  const { tagName } = route.params;
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

  const tagTasks = useMemo(
    () => taskList.filter((t) => t.tags.includes(tagName)),
    [taskList, tagName],
  );

  const displayTasks = useMemo(
    () => applySort(applyFilter(tagTasks, filter), sort),
    [tagTasks, filter, sort],
  );

  React.useEffect(() => {
    navigation.setOptions({ title: `#${String(tagName)}` });
  }, [navigation, tagName]);

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
        emptyTitle="No tasks with this tag"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
