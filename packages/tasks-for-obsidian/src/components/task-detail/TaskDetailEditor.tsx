import React, { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import type { Task } from "../../domain/types";
import { useSettings } from "../../hooks/use-settings";
import { formatRelativeDate } from "../../lib/dates";
import { typography } from "../../styles/typography";
import { AppIcon } from "../common/AppIcon";
import { ScheduleSheet, type ScheduleField } from "../input/ScheduleSheet";
import {
  AnchorOption,
  Divider,
  MetadataButton,
  PriorityMenuRow,
  RecurrenceMenuRow,
  ReadOnlyRow,
  SectionTitle,
} from "./TaskDetailControls";
import { TaskDetailOrganize } from "./TaskDetailOrganize";
import type { TaskDetailDraft } from "./task-detail-draft";
import { taskDetailStyles as styles } from "./task-detail-styles";
import { TaskDetailTaskActions } from "./TaskDetailTaskActions";

type Props = {
  readonly task: Task;
  readonly draft: TaskDetailDraft;
  readonly dayCounts?: ReadonlyMap<string, number> | undefined;
  readonly availableProjects: readonly string[];
  readonly availableContexts: readonly string[];
  readonly availableTags: readonly string[];
  readonly validationField: "title" | "recurrence" | "timeEstimate" | null;
  readonly validationMessage: string | null;
  readonly isWorking: boolean;
  readonly isTracking: boolean;
  readonly onChange: (draft: TaskDetailDraft) => void;
  readonly onToggleCompletion: () => void;
  readonly onToggleTracking: () => void;
  readonly onDelete: () => void;
};

export function TaskDetailEditor({
  task,
  draft,
  dayCounts,
  availableProjects,
  availableContexts,
  availableTags,
  validationField,
  validationMessage,
  isWorking,
  isTracking,
  onChange,
  onToggleCompletion,
  onToggleTracking,
  onDelete,
}: Props) {
  const { colors } = useSettings();
  const [scheduleField, setScheduleField] = useState<ScheduleField | null>(
    null,
  );
  const applySchedule = useCallback(
    (field: ScheduleField, value: string | null) => {
      onChange(
        field === "due"
          ? { ...draft, due: value }
          : { ...draft, scheduled: value },
      );
    },
    [draft, onChange],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <TextInput
            style={[styles.titleInput, { color: colors.text }]}
            value={draft.title}
            onChangeText={(title) => {
              onChange({ ...draft, title });
            }}
            placeholder="Task title"
            placeholderTextColor={colors.textTertiary}
            multiline
            clearButtonMode="while-editing"
            accessibilityLabel="Task title"
            accessibilityHint="Always editable"
            testID="task-detail-title-input"
          />
          <View
            style={[
              styles.cardDivider,
              { backgroundColor: colors.borderLight },
            ]}
          />
          <TextInput
            style={[styles.detailsInput, { color: colors.text }]}
            value={draft.details}
            onChangeText={(details) => {
              onChange({ ...draft, details });
            }}
            placeholder="Add details (Markdown supported)"
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Task details"
            testID="task-detail-details-input"
          />
          {validationField === "title" && validationMessage ? (
            <Text
              style={[typography.caption, { color: colors.error }]}
              accessibilityRole="alert"
              testID="task-detail-validation"
            >
              {validationMessage}
            </Text>
          ) : null}
        </View>

        <TaskDetailTaskActions
          task={task}
          isTracking={isTracking}
          isWorking={isWorking}
          onToggleCompletion={onToggleCompletion}
          onToggleTracking={onToggleTracking}
        />

        <SectionTitle>Plan</SectionTitle>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <MetadataButton
            icon="calendar"
            label="Planned"
            value={
              draft.scheduled
                ? formatRelativeDate(draft.scheduled)
                : "Not planned"
            }
            onPress={() => {
              setScheduleField("scheduled");
            }}
            testID="task-detail-scheduled-row"
          />
          <Divider color={colors.borderLight} />
          <MetadataButton
            icon="flag"
            label="Deadline"
            value={draft.due ? formatRelativeDate(draft.due) : "No deadline"}
            onPress={() => {
              setScheduleField("due");
            }}
            testID="task-detail-due-row"
          />
          <Divider color={colors.borderLight} />
          <PriorityMenuRow
            value={draft.priority}
            onChange={(priority) => {
              onChange({ ...draft, priority });
            }}
          />
        </View>

        <SectionTitle>Repeat</SectionTitle>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <RecurrenceMenuRow
            value={draft.recurrence}
            onChange={(recurrence) => {
              onChange({ ...draft, recurrence });
            }}
          />
          {validationField === "recurrence" && validationMessage ? (
            <Text
              style={[
                typography.caption,
                styles.fieldError,
                { color: colors.error },
              ]}
              accessibilityRole="alert"
              testID="task-detail-validation"
            >
              {validationMessage}
            </Text>
          ) : null}
          {draft.recurrence.length > 0 ? (
            <View style={styles.anchorRow}>
              <AnchorOption
                label="From planned date"
                selected={draft.recurrenceAnchor === "scheduled"}
                onPress={() => {
                  onChange({ ...draft, recurrenceAnchor: "scheduled" });
                }}
              />
              <AnchorOption
                label="After completion"
                selected={draft.recurrenceAnchor === "completion"}
                onPress={() => {
                  onChange({ ...draft, recurrenceAnchor: "completion" });
                }}
              />
            </View>
          ) : null}
        </View>

        <TaskDetailOrganize
          draft={draft}
          availableProjects={availableProjects}
          availableContexts={availableContexts}
          availableTags={availableTags}
          onChange={onChange}
        />

        <SectionTitle>Time & Dependencies</SectionTitle>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.formRow}>
            <View style={styles.rowLabelGroup}>
              <AppIcon name="clock" size={19} color={colors.textSecondary} />
              <Text style={[typography.body, { color: colors.text }]}>
                Estimate
              </Text>
            </View>
            <TextInput
              style={[styles.estimateInput, { color: colors.text }]}
              value={draft.timeEstimate}
              onChangeText={(timeEstimate) => {
                onChange({ ...draft, timeEstimate });
              }}
              placeholder="None"
              placeholderTextColor={colors.textTertiary}
              keyboardType="decimal-pad"
              inputMode="decimal"
              accessibilityLabel="Time estimate in minutes"
              testID="task-detail-estimate-input"
            />
            <Text
              style={[typography.bodySmall, { color: colors.textSecondary }]}
            >
              min
            </Text>
          </View>
          {validationField === "timeEstimate" && validationMessage ? (
            <Text
              style={[
                typography.caption,
                styles.fieldError,
                { color: colors.error },
              ]}
              accessibilityRole="alert"
              testID="task-detail-validation"
            >
              {validationMessage}
            </Text>
          ) : null}
          {task.isBlocked || task.blockedBy.length > 0 ? (
            <>
              <Divider color={colors.borderLight} />
              <ReadOnlyRow
                label="Blocked by"
                value={`${task.blockedBy.length} task${task.blockedBy.length === 1 ? "" : "s"}`}
              />
            </>
          ) : null}
          {task.isBlocking ? (
            <>
              <Divider color={colors.borderLight} />
              <ReadOnlyRow label="Dependencies" value="Blocking other work" />
            </>
          ) : null}
        </View>

        <Pressable
          style={styles.deleteButton}
          onPress={onDelete}
          disabled={isWorking}
          accessibilityRole="button"
          accessibilityLabel="Delete task"
          accessibilityHint="Permanently deletes this task after confirmation"
          testID="task-detail-delete"
        >
          <AppIcon name="trash-2" size={18} color={colors.error} />
          <Text style={[typography.body, { color: colors.error }]}>
            Delete Task
          </Text>
        </Pressable>
      </ScrollView>

      <ScheduleSheet
        visible={scheduleField !== null}
        initialField={scheduleField ?? "scheduled"}
        due={draft.due ?? undefined}
        scheduled={draft.scheduled ?? undefined}
        dayCounts={dayCounts}
        onClose={() => {
          setScheduleField(null);
        }}
        onApply={applySchedule}
      />
    </KeyboardAvoidingView>
  );
}
