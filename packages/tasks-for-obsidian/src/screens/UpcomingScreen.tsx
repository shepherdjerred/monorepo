import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { Task } from "../domain/types";
import { deriveUpcomingWeek } from "../domain/agenda";
import { calendarDayOrNull } from "../domain/calendar-day";
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
import { useSelection } from "../hooks/use-selection";
import { BulkActionBar } from "../components/task/BulkActionBar";
import { formatAgendaDayHeading } from "../lib/dates";
import { TaskList } from "../components/task/TaskList";
import { FilterSortBar } from "../components/input/FilterSortBar";
import { Fab } from "../components/common/Fab";
import { UpcomingWeekStrip } from "../components/calendar/UpcomingWeekStrip";

type Props = CompositeScreenProps<
  MainTabScreenProps<"Upcoming">,
  NativeStackScreenProps<RootStackParamList>
>;

export function UpcomingScreen({ navigation, route }: Props) {
  const {
    upcomingTasks,
    upcomingAgenda,
    upcomingDayByTaskId,
    upcomingDateContextByTaskId,
    upcomingCompletionDateByTaskId,
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
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [sort, setSort] = useState<SortConfig | null>(null);
  const selectedDay = calendarDayOrNull(route.params?.selectedDay);
  const today = localTodayYmd();

  useEffect(() => {
    navigation.setParams({ selectionMode });
  }, [navigation, selectionMode]);
  const week = useMemo(
    () => deriveUpcomingWeek(upcomingAgenda, today),
    [today, upcomingAgenda],
  );
  const sectionOrder = useMemo(
    () => upcomingAgenda.map((section) => formatAgendaDayHeading(section.day)),
    [upcomingAgenda],
  );

  const displayTasks = useMemo(() => {
    const selectedTasks =
      selectedDay === null
        ? upcomingTasks
        : upcomingTasks.filter(
            (task) => upcomingDayByTaskId.get(task.id) === selectedDay,
          );
    return applySortOverride(applyFilter(selectedTasks, filter), sort);
  }, [upcomingTasks, upcomingDayByTaskId, selectedDay, filter, sort]);

  const sectionBy = useCallback(
    (task: Task) => {
      const day = upcomingDayByTaskId.get(task.id);
      if (day === undefined) {
        throw new Error(`Missing Upcoming agenda day for task ${task.id}`);
      }
      return formatAgendaDayHeading(day);
    },
    [upcomingDayByTaskId],
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
      <UpcomingWeekStrip
        days={week}
        selectedDay={selectedDay}
        onSelectDay={(day) => {
          navigation.setParams({ selectedDay: day });
        }}
        onToday={() => {
          navigation.navigate("Today");
        }}
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
        emptyTitle={
          selectedDay === null ? "No upcoming tasks" : "Nothing on this day"
        }
        emptySubtitle={
          selectedDay === null
            ? "Future planned dates and deadlines appear here"
            : formatAgendaDayHeading(selectedDay)
        }
        sectionBy={sectionBy}
        sectionOrder={sectionOrder}
        dateContextByTaskId={upcomingDateContextByTaskId}
        completionDateByTaskId={upcomingCompletionDateByTaskId}
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
            handleBulkComplete([...selected], upcomingCompletionDateByTaskId);
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
              createCaptureSeed({
                ...(selectedDay === null ? {} : { scheduled: selectedDay }),
              }),
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
});
