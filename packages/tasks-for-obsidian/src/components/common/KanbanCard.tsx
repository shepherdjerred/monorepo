import React from "react";
import { MenuView, type MenuAction } from "@react-native-menu/menu";
import { Platform, View, Text, Pressable, StyleSheet } from "react-native";
import type { TaskMetadataPresentation } from "../../domain/task-presentation";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import type { Task } from "../../domain/types";
import { deriveKanbanCardPresentation } from "./kanban-card-model";

function actionImage(image: string): Pick<MenuAction, "image"> {
  return Platform.OS === "ios" ? { image } : {};
}

export type KanbanMoveTarget = {
  readonly key: string;
  readonly title: string;
};

type Props = {
  task: Task;
  referenceDate: Date;
  pending?: boolean | undefined;
  onPress: () => void;
  onToggle?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  moveTargets?: readonly KanbanMoveTarget[] | undefined;
  onMoveTo?: ((columnKey: string) => void) | undefined;
};

export const KanbanCard = React.memo(function KanbanCardComponent({
  task,
  referenceDate,
  pending = false,
  onPress,
  onToggle,
  onEdit,
  onDelete,
  moveTargets,
  onMoveTo,
}: Props) {
  const { colors } = useSettings();
  const presentation = deriveKanbanCardPresentation(
    task,
    referenceDate,
    pending,
  );

  const hasMoveActions =
    moveTargets !== undefined &&
    onMoveTo !== undefined &&
    moveTargets.length > 0;
  const hasMenuActions =
    hasMoveActions ||
    onToggle !== undefined ||
    onEdit !== undefined ||
    onDelete !== undefined;

  const card = (
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
      accessibilityLabel={presentation.accessibilityLabel}
      accessibilityHint={
        hasMenuActions
          ? "Double tap to view details, long press for actions"
          : "Double tap to view details"
      }
    >
      <Text
        style={[
          typography.bodySmall,
          styles.title,
          { color: colors.text },
          presentation.completed && styles.completedText,
        ]}
        numberOfLines={2}
      >
        {presentation.title}
      </Text>
      {presentation.metadata.length === 0 ? null : (
        <View style={styles.metadata}>
          {presentation.metadata.map((item) => (
            <Text
              key={metadataKey(item)}
              style={[
                typography.caption,
                styles.metadataItem,
                { color: metadataColor(item, colors) },
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          ))}
        </View>
      )}
      {presentation.indicators.length === 0 ? null : (
        <View style={styles.indicators}>
          {presentation.indicators.map((indicator) => (
            <Text
              key={indicator.kind}
              style={[typography.caption, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {indicator.label}
            </Text>
          ))}
        </View>
      )}
    </Pressable>
  );

  if (!hasMenuActions) return card;

  const actions: MenuAction[] = [];
  if (hasMoveActions) {
    actions.push({
      id: "move",
      title: "Move to…",
      ...actionImage("arrow.right.square"),
      subactions: moveTargets.map((target) => ({
        id: `move-${target.key}`,
        title: target.title,
      })),
    });
  }
  if (onToggle) {
    actions.push({
      id: "toggle",
      title: presentation.completionActionTitle,
      ...actionImage(
        presentation.completed
          ? "arrow.uturn.backward.circle"
          : "checkmark.circle",
      ),
    });
  }
  if (onEdit) {
    actions.push({ id: "edit", title: "Edit", ...actionImage("pencil") });
  }
  if (onDelete) {
    actions.push({
      id: "delete",
      title: "Delete",
      attributes: { destructive: true },
      ...actionImage("trash"),
    });
  }

  return (
    <MenuView
      title={task.title}
      actions={actions}
      shouldOpenOnLongPress
      onPressAction={({ nativeEvent }) => {
        switch (nativeEvent.event) {
          case "toggle":
            if (!onToggle) {
              throw new Error("Toggle action is unavailable for this task");
            }
            onToggle();
            return;
          case "edit":
            if (!onEdit) {
              throw new Error("Edit action is unavailable for this task");
            }
            onEdit();
            return;
          case "delete":
            if (!onDelete) {
              throw new Error("Delete action is unavailable for this task");
            }
            onDelete();
            return;
          default: {
            const target = moveTargets?.find(
              (candidate) => `move-${candidate.key}` === nativeEvent.event,
            );
            if (target === undefined || !onMoveTo) {
              throw new Error(
                `Unknown Kanban task menu action: ${nativeEvent.event}`,
              );
            }
            onMoveTo(target.key);
          }
        }
      }}
      testID="kanban-card-menu"
    >
      {card}
    </MenuView>
  );
});

function metadataKey(item: TaskMetadataPresentation): string {
  switch (item.kind) {
    case "planned":
    case "deadline":
      return `${item.kind}-${item.date}`;
    case "project":
    case "context":
    case "tag":
      return `${item.kind}-${item.value}`;
  }
}

function metadataColor(
  item: TaskMetadataPresentation,
  colors: { error: string; textSecondary: string; primary: string },
): string {
  switch (item.kind) {
    case "planned":
    case "deadline":
      return item.relation === "overdue" ? colors.error : colors.textSecondary;
    case "project":
      return colors.primary;
    case "context":
    case "tag":
      return colors.textSecondary;
  }
}

const styles = StyleSheet.create({
  card: {
    minHeight: 44,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    gap: 4,
  },
  title: {
    fontWeight: "500",
  },
  completedText: {
    textDecorationLine: "line-through",
    opacity: 0.5,
  },
  metadata: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metadataItem: {
    flexShrink: 1,
  },
  indicators: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
});
