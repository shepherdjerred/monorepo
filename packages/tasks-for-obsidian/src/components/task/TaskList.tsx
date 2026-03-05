import React, { useCallback, useMemo, useRef } from "react";
import { SectionList, View, Text, StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { SwipeDirection } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { Task, TaskId } from "../../domain/types";
import type { Priority } from "../../domain/priority";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { groupBy } from "../../lib/utils";
import { TaskRow } from "./TaskRow";
import { EmptyState } from "../common/EmptyState";
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
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptySubtitle?: string | undefined;
  sectionBy?: ((task: Task) => string) | undefined;
};

export function TaskList({
  tasks,
  onTaskPress,
  onTaskToggle,
  onTaskDelete,
  onTaskEdit,
  onTaskSetPriority,
  onRefresh,
  refreshing,
  emptyTitle = "No tasks",
  emptySubtitle,
  sectionBy,
}: TaskListProps) {
  const { colors } = useSettings();
  const openRowRef = useRef<SwipeableMethods | null>(null);

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

      return (
        <ReanimatedSwipeable
          renderLeftActions={renderLeft}
          renderRightActions={renderRight}
          leftThreshold={ACTION_WIDTH}
          rightThreshold={ACTION_WIDTH}
          overshootLeft={false}
          overshootRight={false}
          onSwipeableOpen={handleOpen}
        >
          <TaskRow
            task={item}
            onPress={() => {
              onTaskPress(item.id);
            }}
            onToggle={() => {
              onTaskToggle(item.id);
            }}
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
    [onTaskPress, onTaskToggle, onTaskDelete, onTaskEdit, onTaskSetPriority],
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

  if (tasks.length === 0) {
    return <EmptyState title={emptyTitle} subtitle={emptySubtitle} />;
  }

  return (
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
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
