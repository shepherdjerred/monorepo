import React, { useCallback, useMemo, useRef, useState } from "react";
import { SectionList, View, Text, StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { SwipeDirection } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { Task, TaskId } from "../../domain/types";
import type { FeatherIconName } from "@react-native-vector-icons/feather";
import type { Priority } from "../../domain/priority";
import { useSettings } from "../../hooks/use-settings";
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
  onTaskToggle: (id: TaskId) => void;
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
}: TaskListProps) {
  const { colors } = useSettings();
  const openRowRef = useRef<SwipeableMethods | null>(null);
  const [scheduleTask, setScheduleTask] = useState<Task | null>(null);

  const sections = useMemo(() => {
    if (!sectionBy) {
      return [{ title: "", data: tasks }];
    }
    const groups = groupBy(tasks, sectionBy);
    return Object.entries(groups).map(([title, data]) => ({ title, data }));
  }, [tasks, sectionBy]);

  const renderItem = useCallback(
    ({ item }: { item: Task }) => {
      let swipeableRef: SwipeableMethods | null = null;

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

        if (direction === SwipeDirection.LEFT) {
          onTaskToggle(item.id);
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
                    onTaskToggle(item.id);
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
    ],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => {
      if (!section.title) return null;
      return (
        <View
          style={[styles.sectionHeader, { backgroundColor: colors.surface }]}
        >
          <Text style={[typography.label, { color: colors.textSecondary }]}>
            {section.title}
          </Text>
        </View>
      );
    },
    [colors],
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
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
