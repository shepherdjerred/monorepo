import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { SwipeDirection } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { Task, TaskId } from "../../domain/types";
import type { FeatherIconName } from "@react-native-vector-icons/feather";
import type { Priority } from "../../domain/priority";
import type { TaskDateKind } from "../../domain/task-presentation";
import { localTodayYmd } from "../../domain/recurrence";
import { useSettings } from "../../hooks/use-settings";
import { parseLocalDate } from "../../lib/dates";
import { typography } from "../../styles/typography";
import { groupBy } from "../../lib/utils";
import { feedbackSelection } from "../../lib/feedback";
import { TaskRow } from "./TaskRow";
import { EmptyState } from "../common/EmptyState";
import { ScheduleSheet, type ScheduleField } from "../input/ScheduleSheet";
import {
  LeftSwipeActions,
  RightSwipeActions,
  ACTION_WIDTH,
} from "./SwipeActions";

type TaskListProps = {
  tasks: Task[];
  onTaskPress: (id: TaskId) => void;
  onTaskToggle: (id: TaskId, occurrenceDate?: string) => void;
  onTaskDelete: (id: TaskId) => void;
  onTaskEdit?: ((id: TaskId) => void) | undefined;
  onTaskSetPriority?: ((id: TaskId, priority: Priority) => void) | undefined;
  onTaskSchedule?:
    | ((id: TaskId, field: ScheduleField, value: string | null) => void)
    | undefined;
  dayCounts?: ReadonlyMap<string, number> | undefined;
  selectionMode?: boolean | undefined;
  selectedIds?: ReadonlySet<TaskId> | undefined;
  onToggleSelect?: ((id: TaskId) => void) | undefined;
  pendingIds?: ReadonlySet<TaskId> | undefined;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptySubtitle?: string | undefined;
  emptyIcon?: FeatherIconName | undefined;
  emptyCelebrate?: boolean | undefined;
  sectionBy?: ((task: Task) => string) | undefined;
  sectionOrder?: readonly string[] | undefined;
  sectionAction?:
    | ((section: {
        title: string;
        tasks: readonly Task[];
      }) => { label: string; onPress: () => void } | undefined)
    | undefined;
  dateContextByTaskId?:
    | ReadonlyMap<
        TaskId,
        { readonly kind: TaskDateKind; readonly date: string }
      >
    | undefined;
  completionDateByTaskId?: ReadonlyMap<TaskId, string> | undefined;
};

export function TaskList({
  tasks,
  onTaskPress,
  onTaskToggle,
  onTaskDelete,
  onTaskEdit,
  onTaskSetPriority,
  onTaskSchedule,
  dayCounts,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  pendingIds,
  onRefresh,
  refreshing,
  emptyTitle = "No tasks",
  emptySubtitle,
  emptyIcon,
  emptyCelebrate,
  sectionBy,
  sectionOrder,
  sectionAction,
  dateContextByTaskId,
  completionDateByTaskId,
}: TaskListProps) {
  const { colors } = useSettings();
  const openRowRef = useRef<SwipeableMethods | null>(null);
  const [scheduleTask, setScheduleTask] = useState<Task | null>(null);
  const referenceDay = localTodayYmd();
  const referenceDate = useMemo(
    () => parseLocalDate(referenceDay),
    [referenceDay],
  );

  const sections = useMemo(() => {
    if (!sectionBy) {
      return [{ title: "", data: tasks }];
    }
    const groups = groupBy(tasks, sectionBy);
    const groupedSections = Object.entries(groups).map(([title, data]) => ({
      title,
      data,
    }));
    if (sectionOrder === undefined) return groupedSections;

    const rank = new Map(
      sectionOrder.map((title, index) => [title, index] as const),
    );
    return groupedSections.sort((left, right) => {
      const byRank =
        (rank.get(left.title) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.title) ?? Number.MAX_SAFE_INTEGER);
      return byRank === 0 ? left.title.localeCompare(right.title) : byRank;
    });
  }, [tasks, sectionBy, sectionOrder]);

  const renderItem = useCallback(
    ({ item }: { item: Task }) => {
      let swipeableRef: SwipeableMethods | null = null;
      const completionDate = completionDateByTaskId?.get(item.id);

      const renderLeft = (
        progress: SharedValue<number>,
        _translation: SharedValue<number>,
        methods: SwipeableMethods,
      ) => {
        swipeableRef = methods;
        return <LeftSwipeActions progress={progress} />;
      };

      const renderRight = (
        progress: SharedValue<number>,
        _translation: SharedValue<number>,
        methods: SwipeableMethods,
      ) => {
        swipeableRef = methods;
        return <RightSwipeActions progress={progress} />;
      };

      // Haptic detent the moment the swipe passes its commit threshold.
      const handleWillOpen = () => {
        feedbackSelection();
      };

      const handleOpen = (direction: SwipeDirection) => {
        if (openRowRef.current && openRowRef.current !== swipeableRef) {
          openRowRef.current.close();
        }
        openRowRef.current = swipeableRef;

        if (direction === SwipeDirection.RIGHT) {
          onTaskToggle(item.id, completionDate);
        } else {
          onTaskDelete(item.id);
        }
        swipeableRef?.close();
      };

      const select = (): void => {
        onToggleSelect?.(item.id);
      };

      return (
        <ReanimatedSwipeable
          enabled={!selectionMode}
          renderLeftActions={renderLeft}
          renderRightActions={renderRight}
          leftThreshold={ACTION_WIDTH}
          rightThreshold={ACTION_WIDTH}
          overshootLeft={false}
          overshootRight={false}
          onSwipeableWillOpen={handleWillOpen}
          onSwipeableOpen={handleOpen}
        >
          <TaskRow
            task={item}
            referenceDate={referenceDate}
            dateContext={dateContextByTaskId?.get(item.id)}
            completionDate={completionDate}
            selectionMode={selectionMode}
            selected={selectedIds?.has(item.id) ?? false}
            pending={pendingIds?.has(item.id) ?? false}
            onPress={
              selectionMode
                ? select
                : () => {
                    onTaskPress(item.id);
                  }
            }
            onToggle={
              selectionMode
                ? select
                : () => {
                    onTaskToggle(item.id, completionDate);
                  }
            }
            onSchedule={
              onTaskSchedule
                ? () => {
                    setScheduleTask(item);
                  }
                : undefined
            }
            onEdit={
              onTaskEdit
                ? () => {
                    onTaskEdit(item.id);
                  }
                : undefined
            }
            onDelete={() => {
              onTaskDelete(item.id);
            }}
            onSetPriority={
              onTaskSetPriority
                ? (priority) => {
                    onTaskSetPriority(item.id, priority);
                  }
                : undefined
            }
          />
        </ReanimatedSwipeable>
      );
    },
    [
      onTaskPress,
      onTaskToggle,
      onTaskDelete,
      onTaskEdit,
      onTaskSetPriority,
      onTaskSchedule,
      selectionMode,
      selectedIds,
      onToggleSelect,
      pendingIds,
      referenceDate,
      dateContextByTaskId,
      completionDateByTaskId,
    ],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; data: Task[] } }) => {
      if (!section.title) return null;
      const action = sectionAction?.({
        title: section.title,
        tasks: section.data,
      });
      return (
        <View
          style={[styles.sectionHeader, { backgroundColor: colors.surface }]}
        >
          <View style={styles.sectionSummary}>
            <Text
              style={[typography.label, { color: colors.textSecondary }]}
              accessibilityRole="header"
            >
              {section.title}
            </Text>
            <Text style={[typography.caption, { color: colors.textTertiary }]}>
              {section.data.length === 1
                ? "1 task"
                : `${String(section.data.length)} tasks`}
            </Text>
          </View>
          {action === undefined ? null : (
            <Pressable
              onPress={action.onPress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${action.label} ${section.title.toLowerCase()} tasks`}
            >
              <Text style={[typography.bodySmall, { color: colors.primary }]}>
                {action.label}
              </Text>
            </Pressable>
          )}
        </View>
      );
    },
    [colors, sectionAction],
  );

  const scheduleSheet = onTaskSchedule ? (
    <ScheduleSheet
      visible={scheduleTask !== null}
      due={scheduleTask?.due}
      scheduled={scheduleTask?.scheduled}
      dayCounts={dayCounts}
      onClose={() => {
        setScheduleTask(null);
      }}
      onApply={(field, value) => {
        if (scheduleTask) onTaskSchedule(scheduleTask.id, field, value);
      }}
    />
  ) : null;

  if (tasks.length === 0) {
    return (
      <>
        <EmptyState
          title={emptyTitle}
          subtitle={emptySubtitle}
          icon={emptyIcon}
          celebrate={emptyCelebrate}
        />
        {scheduleSheet}
      </>
    );
  }

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        onRefresh={onRefresh}
        refreshing={refreshing ?? false}
        stickySectionHeadersEnabled
        removeClippedSubviews={true}
        windowSize={10}
        maxToRenderPerBatch={15}
        initialNumToRender={20}
      />
      {scheduleSheet}
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionSummary: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
});
