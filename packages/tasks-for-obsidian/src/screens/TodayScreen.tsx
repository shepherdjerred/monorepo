import React, { useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import { type FilterConfig, type SortConfig, EMPTY_FILTER, DEFAULT_SORT, applyFilter, applySort } from "../domain/filters";
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";
import { Fab } from "../components/common/Fab";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Today">,
  NativeStackScreenProps<RootStackParamList>
>;

export function TodayScreen({ navigation }: Props) {
  const { todayTasks, projectNames, contextNames, tagNames, refreshing, handlePress, handleToggle, handleDelete, handleRefresh, handleFabPress } =
    useTaskListScreen(navigation);
  const [filter, setFilter] = useState<FilterConfig>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

  const displayTasks = useMemo(
    () => applySort(applyFilter(todayTasks, filter), sort),
    [todayTasks, filter, sort],
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
        emptyTitle="Nothing due today"
        emptySubtitle="Tasks due today and overdue tasks appear here"
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
