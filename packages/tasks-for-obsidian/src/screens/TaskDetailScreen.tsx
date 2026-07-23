import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { UpdateTaskRequest } from "../domain/types";
import { PRIORITY_LABELS } from "../domain/priority";
import { STATUS_LABELS } from "../domain/status";
import { useTasks } from "../hooks/use-tasks";
import { useSettings } from "../hooks/use-settings";
import { typography } from "../styles/typography";
import { formatRelativeDate } from "../lib/dates";
import {
  ScheduleSheet,
  type ScheduleField,
} from "../components/input/ScheduleSheet";
import { TaskEditForm } from "../components/task/TaskEditForm";
import { MarkdownView } from "../components/common/MarkdownView";
import { AppIcon } from "../components/common/AppIcon";
import { isCompletedStatus } from "../domain/status";
import {
  feedbackTaskComplete,
  feedbackTaskUncomplete,
  feedbackTaskCreate,
  feedbackTaskDelete,
} from "../lib/feedback";

type Props = NativeStackScreenProps<RootStackParamList, "TaskDetail">;

export function TaskDetailScreen({ route, navigation }: Props) {
  const { taskId } = route.params;
  const { colors } = useSettings();
  const { getTask, updateTask, deleteTask, toggleTask, dayCounts } = useTasks();
  const task = getTask(taskId);

  const [editing, setEditing] = useState(false);
  const [sheetField, setSheetField] = useState<ScheduleField | null>(null);

  const handleSave = useCallback(
    (patch: UpdateTaskRequest) => {
      feedbackTaskCreate();
      void updateTask(taskId, patch);
      setEditing(false);
    },
    [taskId, updateTask],
  );

  const handleDelete = useCallback(() => {
    Alert.alert("Delete Task", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          feedbackTaskDelete();
          void deleteTask(taskId);
          navigation.goBack();
        },
      },
    ]);
  }, [taskId, deleteTask, navigation]);

  // Read-mode picks reschedule immediately — the fast path for
  // "just push this out" without entering the edit form.
  const handleSheetApply = useCallback(
    (field: ScheduleField, value: string | null) => {
      void updateTask(
        taskId,
        field === "due" ? { due: value } : { scheduled: value },
      );
    },
    [taskId, updateTask],
  );

  if (!task) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          Task not found
        </Text>
      </View>
    );
  }

  if (editing) {
    return (
      <TaskEditForm
        task={task}
        dayCounts={dayCounts}
        onSave={handleSave}
        onCancel={() => {
          setEditing(false);
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.heading, { color: colors.text }]}>
          {task.title}
        </Text>

        <View style={styles.meta}>
          <MetaRow
            label="Status"
            value={STATUS_LABELS[task.status]}
            colors={colors}
          />
          <MetaRow
            label="Priority"
            value={PRIORITY_LABELS[task.priority]}
            colors={colors}
          />
          <MetaRow
            label="Due"
            value={task.due ? formatRelativeDate(task.due) : "None"}
            colors={colors}
            onPress={() => {
              setSheetField("due");
            }}
            testID="task-detail-due-meta"
          />
          <MetaRow
            label="Scheduled"
            value={task.scheduled ? formatRelativeDate(task.scheduled) : "None"}
            colors={colors}
            onPress={() => {
              setSheetField("scheduled");
            }}
            testID="task-detail-scheduled-meta"
          />
          {task.recurrence ? (
            <MetaRow
              label="Recurrence"
              value={task.recurrence}
              colors={colors}
            />
          ) : null}
          {task.projects.length > 0 ? (
            <MetaRow
              label="Projects"
              value={task.projects.join(", ")}
              colors={colors}
            />
          ) : null}
          {task.contexts.length > 0 ? (
            <MetaRow
              label="Contexts"
              value={task.contexts.join(", ")}
              colors={colors}
            />
          ) : null}
          {task.tags.length > 0 ? (
            <MetaRow
              label="Tags"
              value={task.tags.join(", ")}
              colors={colors}
            />
          ) : null}
        </View>

        {task.details && task.details.length > 0 ? (
          <View style={styles.detailsSection}>
            <Text style={[typography.label, { color: colors.textSecondary }]}>
              Details
            </Text>
            <MarkdownView content={task.details} />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (isCompletedStatus(task.status)) {
                feedbackTaskUncomplete();
              } else {
                feedbackTaskComplete();
              }
              void toggleTask(taskId);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              isCompletedStatus(task.status)
                ? "Mark as incomplete"
                : "Mark as complete"
            }
            testID="task-detail-toggle"
          >
            <Text style={styles.buttonText}>Toggle Status</Text>
          </Pressable>
          <Pressable
            style={[
              styles.button,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
              },
            ]}
            onPress={() => {
              setEditing(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Edit task"
            testID="task-detail-edit"
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>
              Edit
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, { backgroundColor: colors.error }]}
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete task"
            testID="task-detail-delete"
          >
            <Text style={styles.buttonText}>Delete</Text>
          </Pressable>
        </View>
      </ScrollView>
      <ScheduleSheet
        visible={sheetField !== null}
        initialField={sheetField ?? "due"}
        due={task.due}
        scheduled={task.scheduled}
        dayCounts={dayCounts}
        onClose={() => {
          setSheetField(null);
        }}
        onApply={handleSheetApply}
      />
    </View>
  );
}

function MetaRow({
  label,
  value,
  colors,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  colors: {
    textSecondary: string;
    text: string;
    borderLight: string;
  };
  onPress?: (() => void) | undefined;
  testID?: string | undefined;
}) {
  const content = (
    <>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={metaStyles.value}>
        <Text style={[typography.bodySmall, { color: colors.text }]}>
          {value}
        </Text>
        {onPress ? (
          <AppIcon
            name="chevron-right"
            size={14}
            color={colors.textSecondary}
          />
        ) : null}
      </View>
    </>
  );
  if (!onPress) {
    return (
      <View style={[metaStyles.row, { borderBottomColor: colors.borderLight }]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      style={[metaStyles.row, { borderBottomColor: colors.borderLight }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Opens schedule sheet`}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

const metaStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  value: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
  },
  meta: {
    marginTop: 20,
  },
  detailsSection: {
    marginTop: 20,
    gap: 8,
  },
  actions: {
    marginTop: 24,
    gap: 12,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
