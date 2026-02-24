import React, { useCallback, useMemo } from "react";
import { SectionList, View, Text, StyleSheet } from "react-native";
import type { Task, TaskId } from "../../domain/types";
import { useSettings } from "../../hooks/useSettings";
import { typography } from "../../styles/typography";
import { groupBy } from "../../lib/utils";
import { TaskRow } from "./TaskRow";
import { EmptyState } from "../common/EmptyState";

type TaskListProps = {
  tasks: Task[];
  onTaskPress: (id: TaskId) => void;
  onTaskToggle: (id: TaskId) => void;
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
  onRefresh,
  refreshing,
  emptyTitle = "No tasks",
  emptySubtitle,
  sectionBy,
}: TaskListProps) {
  const { colors } = useSettings();

  const sections = useMemo(() => {
    if (!sectionBy) {
      return [{ title: "", data: tasks }];
    }
    const groups = groupBy(tasks, sectionBy);
    return Object.entries(groups).map(([title, data]) => ({ title, data }));
  }, [tasks, sectionBy]);

  const renderItem = useCallback(
    ({ item }: { item: Task }) => (
      <TaskRow
        task={item}
        onPress={() => onTaskPress(item.id)}
        onToggle={() => onTaskToggle(item.id)}
      />
    ),
    [onTaskPress, onTaskToggle],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => {
      if (!section.title) return null;
      return (
        <View style={[styles.sectionHeader, { backgroundColor: colors.surface }]}>
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
    />
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
