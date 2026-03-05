import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  StyleSheet,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { TaskId } from "../domain/types";
import type { RootStackParamList } from "../navigation/types";
import { useTasks } from "../hooks/use-tasks";
import { useSettings } from "../hooks/use-settings";
import { useDebounce } from "../hooks/use-debounce";
import { feedbackTaskDelete } from "../lib/feedback";
import { TaskList } from "../components/task/TaskList";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

export function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const { taskList, toggleTask, deleteTask } = useTasks();
  const { colors } = useSettings();

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const lower = debouncedQuery.toLowerCase();
    return taskList.filter(
      (t) =>
        t.title.toLowerCase().includes(lower) ||
        t.projects.some((p: string) => p.toLowerCase().includes(lower)) ||
        t.contexts.some((c: string) => c.toLowerCase().includes(lower)) ||
        t.tags.some((tag: string) => tag.toLowerCase().includes(lower)),
    );
  }, [taskList, debouncedQuery]);

  const handlePress = useCallback(
    (id: TaskId) => {
      navigation.navigate("TaskDetail", { taskId: id });
    },
    [navigation],
  );

  const handleToggle = useCallback(
    (id: TaskId) => {
      void toggleTask(id);
    },
    [toggleTask],
  );

  const handleDelete = useCallback(
    (id: TaskId) => {
      Alert.alert("Delete Task", "Are you sure you want to delete this task?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            feedbackTaskDelete();
            void deleteTask(id);
          },
        },
      ]);
    },
    [deleteTask],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.searchBar}>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search tasks..."
          placeholderTextColor={colors.textTertiary}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="Search tasks"
          accessibilityHint="Type to search by title, project, context, or tag"
        />
      </View>
      <TaskList
        tasks={filtered}
        onTaskPress={handlePress}
        onTaskToggle={handleToggle}
        onTaskDelete={handleDelete}
        emptyTitle={
          debouncedQuery.trim() ? "No results" : "Start typing to search"
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBar: {
    padding: 12,
  },
  input: {
    fontSize: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
});
