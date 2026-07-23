import React, { useState, useCallback } from "react";
import {
  Text,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import type { Task, UpdateTaskRequest } from "../../domain/types";
import type { Priority } from "../../domain/priority";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { formatDate, formatRelativeDate } from "../../lib/dates";
import { PriorityPicker } from "../input/PriorityPicker";
import { ScheduleSheet, type ScheduleField } from "../input/ScheduleSheet";
import { AppIcon } from "../common/AppIcon";

const FIELD_LABELS: Record<ScheduleField, string> = {
  due: "Due Date",
  scheduled: "Scheduled",
};

type Props = {
  task: Task;
  dayCounts?: ReadonlyMap<string, number> | undefined;
  onSave: (patch: UpdateTaskRequest) => void;
  onCancel: () => void;
};

/**
 * The staged edit form for TaskDetail: local field state, saved as one
 * update on Save. Date picks stage locally too (via the schedule sheet)
 * and only persist with the rest of the form.
 */
export function TaskEditForm({ task, dayCounts, onSave, onCancel }: Props) {
  const { colors } = useSettings();
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [due, setDue] = useState(task.due);
  const [scheduled, setScheduled] = useState(task.scheduled);
  const [details, setDetails] = useState(task.details ?? "");
  const [sheetField, setSheetField] = useState<ScheduleField | null>(null);

  const handleSave = useCallback(() => {
    onSave({
      title,
      priority,
      due: due ?? null,
      scheduled: scheduled ?? null,
      details,
    });
  }, [onSave, title, priority, due, scheduled, details]);

  const handleSheetApply = useCallback(
    (field: ScheduleField, value: string | null) => {
      if (field === "due") setDue(value ?? undefined);
      else setScheduled(value ?? undefined);
    },
    [],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>
          Title
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
          value={title}
          onChangeText={setTitle}
          testID="task-detail-title-input"
          accessibilityLabel="Task title"
        />

        <Text
          style={[
            typography.label,
            { color: colors.textSecondary },
            styles.sectionLabel,
          ]}
        >
          Priority
        </Text>
        <PriorityPicker value={priority} onChange={setPriority} />

        {(["due", "scheduled"] as const).map((field) => {
          const value = field === "due" ? due : scheduled;
          return (
            <React.Fragment key={field}>
              <Text
                style={[
                  typography.label,
                  { color: colors.textSecondary },
                  styles.sectionLabel,
                ]}
              >
                {FIELD_LABELS[field]}
              </Text>
              <Pressable
                style={[
                  styles.dateRow,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
                onPress={() => {
                  setSheetField(field);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${FIELD_LABELS[field]}: ${value ? formatDate(value) : "none"}. Opens schedule sheet`}
                testID={`task-detail-${field}-row`}
              >
                <Text
                  style={[
                    typography.body,
                    { color: value ? colors.text : colors.textTertiary },
                  ]}
                >
                  {value ? formatRelativeDate(value) : "None"}
                </Text>
                <AppIcon
                  name="calendar"
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            </React.Fragment>
          );
        })}

        <Text
          style={[
            typography.label,
            { color: colors.textSecondary },
            styles.sectionLabel,
          ]}
        >
          Details
        </Text>
        <TextInput
          style={[
            styles.input,
            styles.detailsInput,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
          value={details}
          onChangeText={setDetails}
          placeholder="Add details (markdown supported)"
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
        />

        <Pressable
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          testID="task-detail-save"
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        <Pressable
          style={[
            styles.button,
            styles.cancelButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel editing"
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>
            Cancel
          </Text>
        </Pressable>
      </ScrollView>
      <ScheduleSheet
        visible={sheetField !== null}
        initialField={sheetField ?? "due"}
        due={due}
        scheduled={scheduled}
        dayCounts={dayCounts}
        onClose={() => {
          setSheetField(null);
        }}
        onApply={handleSheetApply}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  sectionLabel: {
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    fontSize: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  detailsInput: {
    minHeight: 120,
  },
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  button: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelButton: {
    marginTop: 12,
    borderWidth: 1,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
