import React from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import * as ContextMenu from "zeego/context-menu";
import type { Task } from "../../domain/types";
import type { Priority } from "../../domain/priority";
import { ALL_PRIORITIES, PRIORITY_LABELS } from "../../domain/priority";
import {
  completionTargetDate,
  isCompletedOn,
  isRecurring,
  localTodayYmd,
} from "../../domain/recurrence";
import { isOverdue } from "../../lib/dates";
import { formatRelativeDate } from "../../lib/dates";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { AppIcon } from "../common/AppIcon";
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
  onSchedule?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onSetPriority?: ((priority: Priority) => void) | undefined;
  /** Multi-select mode: rows toggle selection and the context menu is off. */
  selectionMode?: boolean | undefined;
  selected?: boolean | undefined;
};

function rowAccessibilityLabel(
  task: Task,
  completed: boolean,
  overdue: boolean,
): string {
  const parts = [`Task: ${task.title}`];
  if (completed) parts.push("completed");
  if (overdue) parts.push("overdue");
  if (task.due) parts.push(`due ${formatRelativeDate(task.due)}`);
  const project = task.projects[0];
  if (project !== undefined) parts.push(`project ${String(project)}`);
  return parts.join(", ");
}

export const TaskRow = React.memo(function TaskRow({
  task,
  onPress,
  onToggle,
  onSchedule,
  onEdit,
  onDelete,
  onSetPriority,
  selectionMode = false,
  selected = false,
}: TaskRowProps) {
  const { colors } = useSettings();
  // Recurring tasks read the state of the occurrence a tap would target
  // (the scheduled instance — same date `toggleStatus` completes, so the
  // checkbox and the toggle always agree); plain tasks read by status.
  const completed = isCompletedOn(
    task,
    isRecurring(task) ? completionTargetDate(task) : localTodayYmd(),
  );
  const overdue = isOverdue(task.due);

  const row = (
    <Pressable
      style={[styles.row, { borderBottomColor: colors.borderLight }]}
      onPress={onPress}
      testID="task-row"
      accessibilityRole={selectionMode ? "checkbox" : "button"}
      {...(selectionMode ? { accessibilityState: { checked: selected } } : {})}
      accessibilityLabel={rowAccessibilityLabel(task, completed, overdue)}
    >
      {selectionMode ? (
        <View testID="task-row-selection-mark">
          <AppIcon
            name={selected ? "check-circle" : "circle"}
            size={22}
            color={selected ? colors.primary : colors.textTertiary}
          />
        </View>
      ) : (
        <TaskCheckbox
          status={task.status}
          priority={task.priority}
          onToggle={onToggle}
        />
      )}
      <RowContent
        task={task}
        completed={completed}
        overdue={overdue}
        colors={colors}
      />
    </Pressable>
  );

  // The native context menu owns long-press; in selection mode the row is
  // a plain pressable so taps toggle selection without menu interference.
  if (selectionMode) return row;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{row}</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item key="toggle" onSelect={onToggle}>
          <ContextMenu.ItemTitle>
            {completed ? "Uncomplete" : "Complete"}
          </ContextMenu.ItemTitle>
          <ContextMenu.ItemIcon
            ios={{
              name: completed
                ? "arrow.uturn.backward.circle"
                : "checkmark.circle",
            }}
          />
        </ContextMenu.Item>
        {onSchedule ? (
          <ContextMenu.Item key="schedule" onSelect={onSchedule}>
            <ContextMenu.ItemTitle>Schedule</ContextMenu.ItemTitle>
            <ContextMenu.ItemIcon ios={{ name: "calendar" }} />
          </ContextMenu.Item>
        ) : null}
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
                  onSelect={() => {
                    onSetPriority(p);
                  }}
                >
                  <ContextMenu.ItemTitle>
                    {PRIORITY_LABELS[p]}
                  </ContextMenu.ItemTitle>
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

function RowContent({
  task,
  completed,
  overdue,
  colors,
}: {
  task: Task;
  completed: boolean;
  overdue: boolean;
  colors: {
    text: string;
    error: string;
    textSecondary: string;
    primary: string;
  };
}) {
  return (
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
