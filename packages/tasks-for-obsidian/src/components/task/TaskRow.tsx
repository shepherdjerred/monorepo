import React from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import * as ContextMenu from "zeego/context-menu";
import type { Task } from "../../domain/types";
import type { Priority } from "../../domain/priority";
import { ALL_PRIORITIES, PRIORITY_LABELS } from "../../domain/priority";
import { isCompletedStatus } from "../../domain/status";
import { isOverdue } from "../../lib/dates";
import { formatRelativeDate } from "../../lib/dates";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { TaskCheckbox } from "./TaskCheckbox";

const PRIORITY_SF_ICONS: Record<Priority, string> = {
  highest: "exclamationmark.3",
  high: "exclamationmark.2",
  medium: "exclamationmark",
  normal: "minus",
  low: "arrow.down",
  none: "circle.dashed",
};

type TaskRowProps = {
  task: Task;
  onPress: () => void;
  onToggle: () => void;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onSetPriority?: ((priority: Priority) => void) | undefined;
};

export const TaskRow = React.memo(function TaskRow({ task, onPress, onToggle, onEdit, onDelete, onSetPriority }: TaskRowProps) {
  const { colors } = useSettings();
  const completed = isCompletedStatus(task.status);
  const overdue = isOverdue(task.due);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <Pressable
          style={[styles.row, { borderBottomColor: colors.borderLight }]}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Task: ${task.title}${completed ? ", completed" : ""}${overdue ? ", overdue" : ""}${task.due ? `, due ${formatRelativeDate(task.due)}` : ""}${task.projects.length > 0 && task.projects[0] !== undefined ? `, project ${String(task.projects[0])}` : ""}`}
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
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item key="toggle" onSelect={onToggle}>
          <ContextMenu.ItemTitle>{completed ? "Uncomplete" : "Complete"}</ContextMenu.ItemTitle>
          <ContextMenu.ItemIcon ios={{ name: completed ? "arrow.uturn.backward.circle" : "checkmark.circle" }} />
        </ContextMenu.Item>
        {onEdit ? (
          <ContextMenu.Item key="edit" onSelect={onEdit}>
            <ContextMenu.ItemTitle>Edit</ContextMenu.ItemTitle>
            <ContextMenu.ItemIcon ios={{ name: "pencil" }} />
          </ContextMenu.Item>
        ) : null}
        {onSetPriority ? (
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger key="priority">
              <ContextMenu.ItemTitle>Priority</ContextMenu.ItemTitle>
              <ContextMenu.ItemIcon ios={{ name: "flag" }} />
            </ContextMenu.SubTrigger>
            <ContextMenu.SubContent>
              {ALL_PRIORITIES.map((p) => (
                <ContextMenu.Item
                  key={`priority-${p}`}
                  onSelect={() => { onSetPriority(p); }}
                >
                  <ContextMenu.ItemTitle>{PRIORITY_LABELS[p]}</ContextMenu.ItemTitle>
                  <ContextMenu.ItemIcon ios={{ name: PRIORITY_SF_ICONS[p] }} />
                </ContextMenu.Item>
              ))}
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
        ) : null}
        {onDelete ? (
          <ContextMenu.Item key="delete" destructive onSelect={onDelete}>
            <ContextMenu.ItemTitle>Delete</ContextMenu.ItemTitle>
            <ContextMenu.ItemIcon ios={{ name: "trash" }} />
          </ContextMenu.Item>
        ) : null}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
});

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
