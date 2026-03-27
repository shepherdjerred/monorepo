import React, { useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import {
  EMPTY_FILTER,
  DEFAULT_SORT,
  applyFilter,
  applySort,
} from "../domain/filters";
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import { useTip } from "../hooks/use-tip";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";
import { Fab } from "../components/common/Fab";
import { TipPopover } from "../components/common/TipPopover";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Inbox">,
  NativeStackScreenProps<RootStackParamList>
>;

export function InboxScreen({ navigation }: Props) {
  const {
    inboxTasks,
    projectNames,
    contextNames,
    tagNames,
    refreshing,
    handlePress,
    handleToggle,
    handleDelete,
    handleRefresh,
    handleFabPress,
  } = useTaskListScreen(navigation);
  const swipeTip = useTip("swipe-actions");
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [sort, setSort] = useState(DEFAULT_SORT);

  const displayTasks = useMemo(
    () => applySort(applyFilter(inboxTasks, filter), sort),
    [inboxTasks, filter, sort],
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
        emptyTitle="Inbox is empty"
        emptySubtitle="Tasks without a project appear here"
      />
      <TipPopover
        visible={swipeTip.visible}
        title="Swipe for quick actions"
        message="Swipe left to delete, right to complete"
        onDismiss={swipeTip.dismiss}
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
