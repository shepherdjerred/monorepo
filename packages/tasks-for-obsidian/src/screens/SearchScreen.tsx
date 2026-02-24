import React, { useState, useMemo, useCallback } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { TaskId } from "../domain/types";
import type { RootStackParamList } from "../navigation/types";
import { useTasks } from "../hooks/useTasks";
import { useSettings } from "../hooks/useSettings";
import { TaskList } from "../components/task/TaskList";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

export function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState("");
  const { taskList, toggleTask } = useTasks();
  const { colors } = useSettings();

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    return taskList.filter(
      (t) =>
        t.title.toLowerCase().includes(lower) ||
        t.projects.some((p: string) => p.toLowerCase().includes(lower)) ||
        t.contexts.some((c: string) => c.toLowerCase().includes(lower)) ||
        t.tags.some((tag: string) => tag.toLowerCase().includes(lower)),
    );
  }, [taskList, query]);

  const handlePress = useCallback(
    (id: TaskId) => navigation.navigate("TaskDetail", { taskId: id }),
    [navigation],
  );

  const handleToggle = useCallback(
    (id: TaskId) => toggleTask(id),
    [toggleTask],
  );

  return (
    <View style={styles.container}>
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
        />
      </View>
      <TaskList
        tasks={filtered}
        onTaskPress={handlePress}
        onTaskToggle={handleToggle}
        emptyTitle={query.trim() ? "No results" : "Start typing to search"}
      />
    </View>
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
