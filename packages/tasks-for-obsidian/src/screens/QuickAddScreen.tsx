import React, { useState, useMemo, useCallback } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useTasks } from "../hooks/useTasks";
import { useSettings } from "../hooks/useSettings";
import { parseTaskInput } from "../lib/nlp";
import { feedbackTaskCreate } from "../lib/feedback";
import { NaturalLanguageInput } from "../components/input/NaturalLanguageInput";

type Props = NativeStackScreenProps<RootStackParamList, "QuickAdd">;

export function QuickAddScreen({ route, navigation }: Props) {
  const initialText = route.params?.initialText ?? "";
  const [text, setText] = useState(initialText);
  const { createTask } = useTasks();
  const { colors } = useSettings();

  const parsed = useMemo(() => parseTaskInput(text), [text]);

  const handleCreate = useCallback(() => {
    if (!parsed.title.trim()) return;
    feedbackTaskCreate();
    createTask({
      title: parsed.title,
      due: parsed.due,
      priority: parsed.priority,
      projects: parsed.projects,
      contexts: parsed.contexts,
      tags: parsed.tags,
    });
    navigation.goBack();
  }, [parsed, createTask, navigation]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.inputArea}>
        <NaturalLanguageInput
          value={text}
          onChange={setText}
          parsedResult={parsed}
        />
      </View>
      <Pressable
        style={[
          styles.createButton,
          { backgroundColor: parsed.title.trim() ? colors.primary : colors.border },
        ]}
        onPress={handleCreate}
        disabled={!parsed.title.trim()}
      >
        <Text style={styles.createText}>Create Task</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  inputArea: {
    flex: 1,
  },
  createButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  createText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
