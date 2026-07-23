import React, { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
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
import { formatDayHeading } from "../lib/dates";
import { useSettings } from "../hooks/use-settings";
import { typography } from "../styles/typography";
import { useSelection } from "../hooks/use-selection";
import { BulkActionBar } from "../components/task/BulkActionBar";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";
import { Fab } from "../components/common/Fab";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Today">,
  NativeStackScreenProps<RootStackParamList>
>;

export function TodayScreen({ navigation }: Props) {
  const {
    todayTasks,
    pendingTaskIds,
    projectNames,
    contextNames,
    tagNames,
    refreshing,
    dayCounts,
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
  const { colors } = useSettings();
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [sort, setSort] = useState(DEFAULT_SORT);
  // Distinguishes "cleared the day" from "nothing was ever here": the
  // celebration only shows after a completion interaction on this screen.
  const interacted = useRef(false);

  const displayTasks = useMemo(
    () => applySort(applyFilter(todayTasks, filter), sort),
    [todayTasks, filter, sort],
  );

  const allClear = displayTasks.length === 0 && interacted.current;

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
      <View style={[styles.heading, { borderBottomColor: colors.borderLight }]}>
        <Text style={[typography.heading, { color: colors.text }]}>
          {formatDayHeading()}
        </Text>
        <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
          {displayTasks.length === 0
            ? "No tasks"
            : `${String(displayTasks.length)} task${displayTasks.length === 1 ? "" : "s"}`}
        </Text>
      </View>
      <TaskList
        tasks={displayTasks}
        onTaskPress={handlePress}
        onTaskToggle={(id) => {
          interacted.current = true;
          handleToggle(id);
        }}
        onTaskDelete={handleDelete}
        onTaskSchedule={handleSchedule}
        dayCounts={dayCounts}
        selectionMode={selectionMode}
        selectedIds={selected}
        onToggleSelect={toggleSelected}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        emptyTitle={allClear ? "All clear" : "Nothing due today"}
        emptySubtitle={
          allClear
            ? "Every task for today is done. Nice work."
            : "Tasks due today and overdue tasks appear here"
        }
        emptyIcon={allClear ? "sun" : undefined}
        emptyCelebrate={allClear}
        pendingIds={pendingTaskIds}
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
  heading: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
});
