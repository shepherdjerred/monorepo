import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as ContextMenu from "zeego/context-menu";
import { useSettings } from "../../hooks/use-settings";
import { PRIORITY_COLORS } from "../../domain/priority";
import { formatRelativeDate } from "../../lib/dates";
import type { Task } from "../../domain/types";

export type KanbanMoveTarget = {
  readonly key: string;
  readonly title: string;
};

type Props = {
  task: Task;
  onPress: () => void;
  onToggle?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  moveTargets?: readonly KanbanMoveTarget[] | undefined;
  onMoveTo?: ((columnKey: string) => void) | undefined;
};

export const KanbanCard = React.memo(function KanbanCard({
  task,
  onPress,
  onToggle,
  onEdit,
  onDelete,
  moveTargets,
  onMoveTo,
}: Props) {
  const { colors } = useSettings();

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.border,
            },
          ]}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Task: ${task.title}${task.due ? `, due ${formatRelativeDate(task.due)}` : ""}`}
          accessibilityHint="Double tap to view details, long press for actions"
        >
          <View style={styles.header}>
            <View
              style={[
                styles.priorityDot,
                { backgroundColor: PRIORITY_COLORS[task.priority] },
              ]}
            />
            <Text
              style={[styles.title, { color: colors.text }]}
              numberOfLines={2}
            >
              {task.title}
            </Text>
          </View>
          {task.due ? (
            <Text style={[styles.due, { color: colors.textSecondary }]}>
              {formatRelativeDate(task.due)}
            </Text>
          ) : null}
        </Pressable>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        {moveTargets && moveTargets.length > 0 && onMoveTo ? (
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger key="move">
              <ContextMenu.ItemTitle>Move to...</ContextMenu.ItemTitle>
              <ContextMenu.ItemIcon ios={{ name: "arrow.right.square" }} />
            </ContextMenu.SubTrigger>
            <ContextMenu.SubContent>
              {moveTargets.map((target) => (
                <ContextMenu.Item
                  key={`move-${target.key}`}
                  onSelect={() => {
                    onMoveTo(target.key);
                  }}
                >
                  <ContextMenu.ItemTitle>{target.title}</ContextMenu.ItemTitle>
                </ContextMenu.Item>
              ))}
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
        ) : null}
        {onToggle ? (
          <ContextMenu.Item key="toggle" onSelect={onToggle}>
            <ContextMenu.ItemTitle>Toggle Status</ContextMenu.ItemTitle>
            <ContextMenu.ItemIcon ios={{ name: "checkmark.circle" }} />
          </ContextMenu.Item>
        ) : null}
        {onEdit ? (
          <ContextMenu.Item key="edit" onSelect={onEdit}>
            <ContextMenu.ItemTitle>Edit</ContextMenu.ItemTitle>
            <ContextMenu.ItemIcon ios={{ name: "pencil" }} />
          </ContextMenu.Item>
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
  card: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    gap: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  due: {
    fontSize: 12,
    marginLeft: 14,
  },
});
