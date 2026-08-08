import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Task, TaskId } from "../../domain/types";
import { useSettings } from "../../hooks/use-settings";
import { TaskList } from "../task/TaskList";

type Props = {
  readonly visible: boolean;
  readonly tasks: readonly Task[];
  readonly pendingIds: ReadonlySet<TaskId>;
  readonly onClose: () => void;
  readonly onTaskPress: (id: TaskId) => void;
  readonly onTaskToggle: (id: TaskId) => void;
  readonly onTaskDelete: (id: TaskId) => void;
};

export function CompletedTasksModal({
  visible,
  tasks,
  pendingIds,
  onClose,
  onTaskPress,
  onTaskToggle,
  onTaskDelete,
}: Props) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");

  const displayTasks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered =
      needle.length === 0
        ? tasks
        : tasks.filter((task) =>
            [
              task.title,
              task.details ?? "",
              ...task.projects.map(String),
              ...task.contexts.map(String),
              ...task.tags.map(String),
            ].some((value) => value.toLocaleLowerCase().includes(needle)),
          );

    return [...filtered].sort((a, b) => {
      if (a.completedDate === undefined && b.completedDate === undefined) {
        return a.title.localeCompare(b.title);
      }
      if (a.completedDate === undefined) return 1;
      if (b.completedDate === undefined) return -1;
      return b.completedDate.localeCompare(a.completedDate);
    });
  }, [query, tasks]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      allowSwipeDismissal
      onRequestClose={onClose}
      onShow={() => {
        setQuery("");
      }}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingTop: Math.max(insets.top, 8),
          },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSide} />
          <View style={styles.headerTitle}>
            <Text style={[styles.title, { color: colors.text }]}>
              Completed
            </Text>
            <Text style={[styles.count, { color: colors.textSecondary }]}>
              {String(tasks.length)} tasks
            </Text>
          </View>
          <Pressable
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close completed tasks"
            testID="completed-tasks-close"
          >
            <Text style={[styles.done, { color: colors.primary }]}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.searchContainer}>
          <TextInput
            style={[
              styles.search,
              {
                color: colors.text,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search completed tasks"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            accessibilityLabel="Search completed tasks"
            testID="completed-tasks-search"
          />
        </View>

        <TaskList
          tasks={displayTasks}
          pendingIds={pendingIds}
          onTaskPress={(id) => {
            onClose();
            onTaskPress(id);
          }}
          onTaskToggle={onTaskToggle}
          onTaskDelete={onTaskDelete}
          emptyTitle={
            query.trim().length === 0 ? "No completed tasks" : "No results"
          }
          emptySubtitle="Completed and cancelled tasks appear here."
          emptyIcon="check-circle"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  headerSide: {
    width: 72,
  },
  headerTitle: {
    flex: 1,
    alignItems: "center",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  count: {
    fontSize: 12,
    marginTop: 1,
  },
  closeButton: {
    width: 72,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  done: {
    fontSize: 17,
    fontWeight: "600",
  },
  searchContainer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  search: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 16,
  },
});
