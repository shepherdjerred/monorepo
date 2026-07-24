import React, { useState, useMemo } from "react";
import {
  View,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useTaskListScreen } from "../hooks/use-task-list-screen";
import { useSettings } from "../hooks/use-settings";
import { useDebounce } from "../hooks/use-debounce";
import { TaskList } from "../components/task/TaskList";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

export function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const {
    taskList,
    dayCounts,
    handlePress,
    handleToggle,
    handleDelete,
    handleSchedule,
  } = useTaskListScreen(navigation);
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
        onTaskSchedule={handleSchedule}
        dayCounts={dayCounts}
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
