import React from "react";
import { MenuView, type MenuAction } from "@react-native-menu/menu";
import { Platform, Pressable, View, Text, StyleSheet } from "react-native";
import type { Task } from "../../domain/types";
import type { Priority } from "../../domain/priority";
import { ALL_PRIORITIES, PRIORITY_LABELS } from "../../domain/priority";
import {
  completionTargetDate,
  isCompletedOn,
  isRecurring,
  localTodayYmd,
} from "../../domain/recurrence";
import {
  deriveTaskPresentation,
  type TaskDateKind,
  type TaskMetadataPresentation,
} from "../../domain/task-presentation";
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

function actionImage(image: string): Pick<MenuAction, "image"> {
  return Platform.OS === "ios" ? { image } : {};
}

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
  /** Has unsynced pending changes — renders a quiet dot by the title. */
  pending?: boolean | undefined;
  /** One list-wide clock keeps every row's relative date in agreement. */
  referenceDate: Date;
  dateContext?:
    | { readonly kind: TaskDateKind; readonly date: string }
    | undefined;
  /** Explicit recurring instance represented by this agenda row. */
  completionDate?: string | undefined;
};

export const TaskRow = React.memo(function TaskRowComponent({
  task,
  onPress,
  onToggle,
  onSchedule,
  onEdit,
  onDelete,
  onSetPriority,
  selectionMode = false,
  selected = false,
  pending = false,
  referenceDate,
  dateContext,
  completionDate,
}: TaskRowProps) {
  const { colors } = useSettings();
  // Recurring tasks read the state of the occurrence a tap would target
  // (the scheduled instance — same date `toggleStatus` completes, so the
  // checkbox and the toggle always agree); plain tasks read by status.
  const completed = isCompletedOn(
    task,
    isRecurring(task)
      ? (completionDate ?? completionTargetDate(task))
      : localTodayYmd(),
  );
  const presentation = deriveTaskPresentation(task, {
    referenceDate,
    pending,
    dateContext,
  });
  const accessibilityLabel = completed
    ? `${presentation.accessibilityLabel}, completed`
    : presentation.accessibilityLabel;

  if (selectionMode) {
    return (
      <Pressable
        style={[
          styles.row,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.divider,
          },
        ]}
        onPress={onPress}
        testID={`task-row-${String(task.id)}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Double tap to toggle selection"
      >
        <View style={styles.selectionTarget} testID="task-row-selection-mark">
          <AppIcon
            name={selected ? "check-circle" : "circle"}
            size={22}
            color={selected ? colors.primary : colors.textTertiary}
          />
        </View>
        <RowContent
          presentation={presentation}
          completed={completed}
          colors={colors}
        />
        {pending ? (
          <View
            style={[
              styles.pendingDot,
              { backgroundColor: colors.textTertiary },
            ]}
            testID="task-row-pending-dot"
            accessibilityLabel="Waiting to sync"
          />
        ) : null}
      </Pressable>
    );
  }

  // Keep completion and opening details as sibling accessibility targets.
  // Nesting the checkbox inside one accessible row button makes VoiceOver
  // collapse it into the parent and removes direct completion from the rotor.
  const openButton = (
    <Pressable
      style={styles.openButton}
      onPress={onPress}
      testID={`task-row-${String(task.id)}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Double tap to view details"
    >
      <RowContent
        presentation={presentation}
        completed={completed}
        colors={colors}
      />
      {pending ? (
        <View
          style={[styles.pendingDot, { backgroundColor: colors.textTertiary }]}
          testID="task-row-pending-dot"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </Pressable>
  );

  const actions: MenuAction[] = [
    {
      id: "toggle",
      title: completed ? "Uncomplete" : "Complete",
      ...actionImage(
        completed ? "arrow.uturn.backward.circle" : "checkmark.circle",
      ),
    },
  ];
  if (onSchedule) {
    actions.push({
      id: "schedule",
      title: "Schedule",
      ...actionImage("calendar"),
    });
  }
  if (onEdit) {
    actions.push({ id: "edit", title: "Edit", ...actionImage("pencil") });
  }
  if (onSetPriority) {
    actions.push({
      id: "priority",
      title: "Priority",
      ...actionImage("flag"),
      subactions: ALL_PRIORITIES.map((priority) => ({
        id: `priority-${priority}`,
        title: PRIORITY_LABELS[priority],
        ...actionImage(PRIORITY_SF_ICONS[priority]),
        state: priority === task.priority ? "on" : "off",
      })),
    });
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
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.divider,
        },
      ]}
      testID="task-row-container"
    >
      <TaskCheckbox
        completed={completed}
        priority={task.priority}
        onToggle={onToggle}
        accessibilityLabel={`${completed ? "Uncheck" : "Check"} ${task.title}`}
        testID={`task-checkbox-${String(task.id)}`}
      />
      {openButton}
      <MenuView
        style={styles.menuButton}
        title={task.title}
        actions={actions}
        onPressAction={({ nativeEvent }) => {
          switch (nativeEvent.event) {
            case "toggle":
              onToggle();
              return;
            case "schedule":
              if (!onSchedule) {
                throw new Error("Schedule action is unavailable for this task");
              }
              onSchedule();
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
              const priority = ALL_PRIORITIES.find(
                (candidate) => `priority-${candidate}` === nativeEvent.event,
              );
              if (priority === undefined || !onSetPriority) {
                throw new Error(
                  `Unknown task menu action: ${nativeEvent.event}`,
                );
              }
              onSetPriority(priority);
            }
          }
        }}
        testID={`task-row-menu-${String(task.id)}`}
      >
        <View
          style={styles.menuIcon}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${task.title}`}
          pointerEvents="none"
        >
          <AppIcon
            name="more-horizontal"
            size={20}
            color={colors.textTertiary}
          />
        </View>
      </MenuView>
    </View>
  );
});

function RowContent({
  presentation,
  completed,
  colors,
}: {
  presentation: ReturnType<typeof deriveTaskPresentation>;
  completed: boolean;
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
        numberOfLines={2}
      >
        {presentation.title}
      </Text>
      {presentation.metadata.length > 0 ? (
        <View style={styles.metadata}>
          {presentation.metadata.slice(0, 3).map((item) => (
            <Text
              key={metadataKey(item)}
              style={[
                typography.caption,
                styles.metadataItem,
                {
                  color: metadataColor(item, colors),
                },
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          ))}
        </View>
      ) : null}
      {presentation.indicators.some(
        (indicator) => indicator.kind !== "pending-sync",
      ) ? (
        <View style={styles.indicators}>
          {presentation.indicators
            .filter((indicator) => indicator.kind !== "pending-sync")
            .slice(0, 3)
            .map((indicator) => (
              <Text
                key={indicator.kind}
                style={[typography.caption, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {indicator.label}
              </Text>
            ))}
        </View>
      ) : null}
    </View>
  );
}

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
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  selectionTarget: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
  },
  menuButton: {
    width: 44,
    height: 44,
  },
  menuIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  openButton: {
    minHeight: 44,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  metadata: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  metadataItem: {
    flexShrink: 1,
  },
  indicators: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  completedText: {
    textDecorationLine: "line-through",
    opacity: 0.5,
  },
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
