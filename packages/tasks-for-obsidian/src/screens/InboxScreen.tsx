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
import { useSelection } from "../hooks/use-selection";
import { BulkActionBar } from "../components/task/BulkActionBar";
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
    dayCounts,
    pendingTaskIds,
    handlePress,
    handleToggle,
    handleDelete,
    handleRefresh,
    handleSchedule,
    handleFabPress,
    handleBulkComplete,
    handleBulkDelete,
    handleBulkSchedule,
    handleBulkPriority,
  } = useTaskListScreen(navigation);
  const {
    selectionMode,
    selected,
    enterSelection,
    exitSelection,
    toggleSelected,
  } = useSelection();
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
        selectionMode={selectionMode}
        onToggleSelection={selectionMode ? exitSelection : enterSelection}
      />
      <TaskList
        tasks={displayTasks}
        onTaskPress={handlePress}
        onTaskToggle={handleToggle}
        onTaskDelete={handleDelete}
        onTaskSchedule={handleSchedule}
        dayCounts={dayCounts}
        selectionMode={selectionMode}
        selectedIds={selected}
        onToggleSelect={toggleSelected}
        pendingIds={pendingTaskIds}
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
      {selectionMode ? (
        <BulkActionBar
          count={selected.size}
          dayCounts={dayCounts}
          onSchedule={(field, value) => {
            handleBulkSchedule([...selected], field, value);
            exitSelection();
          }}
          onComplete={() => {
            handleBulkComplete([...selected]);
            exitSelection();
          }}
          onDelete={() => {
            handleBulkDelete([...selected], exitSelection);
          }}
          onSetPriority={(priority) => {
            handleBulkPriority([...selected], priority);
            exitSelection();
          }}
          onDone={exitSelection}
        />
      ) : (
        <Fab onPress={handleFabPress} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
