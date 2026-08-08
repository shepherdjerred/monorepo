import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { Task, TaskId } from "../domain/types";
import { createCaptureSeed } from "../domain/quick-capture-seed";
import { localTodayYmd } from "../domain/recurrence";
import type { RootStackParamList } from "../navigation/types";
import type { MainTabScreenProps } from "../navigation/main-tabs";
import {
  EMPTY_FILTER,
  applyFilter,
  applySortOverride,
} from "../domain/filters";
import type { SortConfig } from "../domain/filters";
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import { formatDayHeading } from "../lib/dates";
import { useSettings } from "../hooks/use-settings";
import { typography } from "../styles/typography";
import { useSelection } from "../hooks/use-selection";
import { BulkActionBar } from "../components/task/BulkActionBar";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";
import { ScheduleSheet } from "../components/input/ScheduleSheet";
import { Fab } from "../components/common/Fab";

const TODAY_SECTION_ORDER = ["Overdue", "Today", "Due Today"] as const;

type Props = CompositeScreenProps<
  MainTabScreenProps<"Today">,
  NativeStackScreenProps<RootStackParamList>
>;

export function TodayScreen({ navigation }: Props) {
  const {
    todayTasks,
    todaySectionByTaskId,
    todayDateContextByTaskId,
    todayCompletionDateByTaskId,
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
  const [sort, setSort] = useState<SortConfig | null>(null);
  const [rescheduleTaskIds, setRescheduleTaskIds] = useState<readonly TaskId[]>(
    [],
  );
  // Distinguishes "cleared the day" from "nothing was ever here": the
  // celebration only shows after a completion interaction on this screen.
  const interacted = useRef(false);

  useEffect(() => {
    navigation.setParams({ selectionMode });
  }, [navigation, selectionMode]);

  const displayTasks = useMemo(
    () => applySortOverride(applyFilter(todayTasks, filter), sort),
    [todayTasks, filter, sort],
  );

  const allClear = todayTasks.length === 0 && interacted.current;
  const noFilterMatches = displayTasks.length === 0 && todayTasks.length > 0;
  const sectionBy = useMemo(
    () => (task: Task) => {
      const section = todaySectionByTaskId.get(task.id);
      if (section === undefined) {
        throw new Error(`Missing Today agenda section for task ${task.id}`);
      }
      return section;
    },
    [todaySectionByTaskId],
  );
  const sectionAction = useMemo(
    () =>
      ({ title, tasks }: { title: string; tasks: readonly Task[] }) =>
        title === "Overdue"
          ? {
              label: "Reschedule",
              onPress: () => {
                setRescheduleTaskIds(tasks.map((task) => task.id));
              },
            }
          : undefined,
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
        onTaskToggle={(id, occurrenceDate) => {
          interacted.current = true;
          handleToggle(id, occurrenceDate);
        }}
        onTaskDelete={handleDelete}
        onTaskSchedule={handleSchedule}
        dayCounts={dayCounts}
        selectionMode={selectionMode}
        selectedIds={selected}
        onToggleSelect={toggleSelected}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        emptyTitle={
          noFilterMatches
            ? "No matching tasks"
            : allClear
              ? "All clear"
              : "Nothing planned today"
        }
        emptySubtitle={
          noFilterMatches
            ? "Adjust or clear your filters to see today's tasks."
            : allClear
              ? "Every task for today is done. Nice work."
              : "Overdue, planned, and deadline tasks appear here"
        }
        emptyIcon={allClear ? "sun" : undefined}
        emptyCelebrate={allClear}
        pendingIds={pendingTaskIds}
        sectionBy={sectionBy}
        sectionOrder={TODAY_SECTION_ORDER}
        sectionAction={sectionAction}
        dateContextByTaskId={todayDateContextByTaskId}
        completionDateByTaskId={todayCompletionDateByTaskId}
      />
      <ScheduleSheet
        visible={rescheduleTaskIds.length > 0}
        initialField="scheduled"
        dayCounts={dayCounts}
        onClose={() => {
          setRescheduleTaskIds([]);
        }}
        onApply={(field, value) => {
          handleBulkSchedule(rescheduleTaskIds, field, value);
          setRescheduleTaskIds([]);
        }}
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
            interacted.current = true;
            handleBulkComplete([...selected], todayCompletionDateByTaskId);
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
        <Fab
          onPress={() => {
            navigation.navigate(
              "QuickAdd",
              createCaptureSeed({ scheduled: localTodayYmd() }),
            );
          }}
        />
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
