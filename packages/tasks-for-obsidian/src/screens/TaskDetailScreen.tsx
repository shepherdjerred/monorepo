import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { Priority } from "../domain/priority";
import { PRIORITY_LABELS } from "../domain/priority";
import { STATUS_LABELS } from "../domain/status";
import { useTasks } from "../hooks/useTasks";
import { useSettings } from "../hooks/useSettings";
import { typography } from "../styles/typography";
import { formatRelativeDate } from "../lib/dates";
import { PriorityPicker } from "../components/input/PriorityPicker";
import { DatePicker } from "../components/input/DatePicker";
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
  const { getTask, updateTask, deleteTask, toggleTask } = useTasks();
  const task = getTask(taskId);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task?.title ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "normal");
  const [due, setDue] = useState<string | undefined>(task?.due);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setPriority(task.priority);
      setDue(task.due);
    }
  }, [task]);

  const handleSave = useCallback(() => {
    feedbackTaskCreate();
    updateTask(taskId, { title, priority, due: due ?? null });
    setEditing(false);
  }, [taskId, title, priority, due, updateTask]);

  const handleDelete = useCallback(() => {
    Alert.alert("Delete Task", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          feedbackTaskDelete();
          deleteTask(taskId);
          navigation.goBack();
        },
      },
    ]);
  }, [taskId, deleteTask, navigation]);

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
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={[typography.label, { color: colors.textSecondary }]}>Title</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={[typography.label, { color: colors.textSecondary }, styles.sectionLabel]}>Priority</Text>
        <PriorityPicker value={priority} onChange={setPriority} />

        <Text style={[typography.label, { color: colors.textSecondary }, styles.sectionLabel]}>Due Date</Text>
        <DatePicker value={due} onChange={setDue} />

        <View style={styles.actions}>
          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={handleSave}
          >
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
          <Pressable
            style={[styles.button, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
            onPress={() => setEditing(false)}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={[typography.heading, { color: colors.text }]}>{task.title}</Text>

      <View style={styles.meta}>
        <MetaRow label="Status" value={STATUS_LABELS[task.status]} colors={colors} />
        <MetaRow label="Priority" value={PRIORITY_LABELS[task.priority]} colors={colors} />
        {task.due ? <MetaRow label="Due" value={formatRelativeDate(task.due)} colors={colors} /> : null}
        {task.recurrence ? <MetaRow label="Recurrence" value={task.recurrence} colors={colors} /> : null}
        {task.projects.length > 0 ? <MetaRow label="Projects" value={task.projects.join(", ")} colors={colors} /> : null}
        {task.contexts.length > 0 ? <MetaRow label="Contexts" value={task.contexts.join(", ")} colors={colors} /> : null}
        {task.tags.length > 0 ? <MetaRow label="Tags" value={task.tags.join(", ")} colors={colors} /> : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={() => {
            if (isCompletedStatus(task.status)) {
              feedbackTaskUncomplete();
            } else {
              feedbackTaskComplete();
            }
            toggleTask(taskId);
          }}
        >
          <Text style={styles.buttonText}>Toggle Status</Text>
        </Pressable>
        <Pressable
          style={[styles.button, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
          onPress={() => setEditing(true)}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
        </Pressable>
        <Pressable
          style={[styles.button, { backgroundColor: colors.error }]}
          onPress={handleDelete}
        >
          <Text style={styles.buttonText}>Delete</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function MetaRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: { textSecondary: string; text: string; borderLight: string };
}) {
  return (
    <View style={[metaStyles.row, { borderBottomColor: colors.borderLight }]}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typography.bodySmall, { color: colors.text }]}>{value}</Text>
    </View>
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
