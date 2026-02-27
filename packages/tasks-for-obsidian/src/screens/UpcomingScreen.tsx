import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import { type FilterConfig, type SortConfig, EMPTY_FILTER, DEFAULT_SORT, applyFilter, applySort } from "../domain/filters";
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import { getDateGroup } from "../lib/dates";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";
import { Fab } from "../components/common/Fab";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Upcoming">,
  NativeStackScreenProps<RootStackParamList>
>;

export function UpcomingScreen({ navigation }: Props) {
  const { upcomingTasks, projectNames, contextNames, tagNames, refreshing, handlePress, handleToggle, handleDelete, handleRefresh, handleFabPress } =
    useTaskListScreen(navigation);
  const [filter, setFilter] = useState<FilterConfig>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

  const displayTasks = useMemo(
    () => applySort(applyFilter(upcomingTasks, filter), sort),
    [upcomingTasks, filter, sort],
  );

  const sectionBy = useCallback(
    (task: { due?: string | undefined }) => (task.due ? getDateGroup(task.due) : "No Date"),
    [],
  );

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
        onRefresh={handleRefresh}
        refreshing={refreshing}
        emptyTitle="No upcoming tasks"
        emptySubtitle="Tasks with future due dates appear here"
        sectionBy={sectionBy}
      />
      <Fab onPress={handleFabPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
