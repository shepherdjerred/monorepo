import React from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import type { Task } from "../../domain/types";
import { isCompletedStatus } from "../../domain/status";
import { isOverdue } from "../../lib/dates";
import { formatRelativeDate } from "../../lib/dates";
import { useSettings } from "../../hooks/useSettings";
import { typography } from "../../styles/typography";
import { TaskCheckbox } from "./TaskCheckbox";

type TaskRowProps = {
  task: Task;
  onPress: () => void;
  onToggle: () => void;
};

export function TaskRow({ task, onPress, onToggle }: TaskRowProps) {
  const { colors } = useSettings();
  const completed = isCompletedStatus(task.status);
  const overdue = isOverdue(task.due);

  return (
    <Pressable
      style={[styles.row, { borderBottomColor: colors.borderLight }]}
      onPress={onPress}
    >
      <TaskCheckbox
        status={task.status}
        priority={task.priority}
        onToggle={onToggle}
      />
      <View style={styles.content}>
        <Text
          style={[
            typography.body,
            { color: colors.text },
            completed && styles.completedText,
          ]}
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <View style={styles.badges}>
          {task.due ? (
            <Text
              style={[
                typography.caption,
                { color: overdue ? colors.error : colors.textSecondary },
              ]}
            >
              {formatRelativeDate(task.due)}
            </Text>
          ) : null}
          {task.projects.length > 0 ? (
            <Text style={[typography.caption, { color: colors.primary }]}>
              {task.projects[0]}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  content: {
    flex: 1,
  },
  badges: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  completedText: {
    textDecorationLine: "line-through",
    opacity: 0.5,
  },
});
