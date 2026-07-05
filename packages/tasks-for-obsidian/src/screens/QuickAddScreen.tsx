import React, { useState, useMemo, useCallback } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useTasks } from "../hooks/use-tasks";
import { useSettings } from "../hooks/use-settings";
import { useTip } from "../hooks/use-tip";
import { parseTaskInput } from "../lib/nlp";
import { feedbackTaskCreate } from "../lib/feedback";
import { NaturalLanguageInput } from "../components/input/NaturalLanguageInput";
import { TipPopover } from "../components/common/TipPopover";

type Props = NativeStackScreenProps<RootStackParamList, "QuickAdd">;

export function QuickAddScreen({ route, navigation }: Props) {
  const initialText = route.params?.initialText ?? "";
  const [text, setText] = useState(initialText);
  const { createTask } = useTasks();
  const { colors } = useSettings();
  const nlpTip = useTip("natural-language");

  const parsed = useMemo(() => parseTaskInput(text), [text]);

  const handleCreate = useCallback(() => {
    if (!parsed.title.trim()) return;
    feedbackTaskCreate();
    void createTask({
      title: parsed.title,
      due: parsed.due,
      priority: parsed.priority,
      projects: parsed.projects,
      contexts: parsed.contexts,
      tags: parsed.tags,
    });
    navigation.goBack();
  }, [parsed, createTask, navigation]);

  // The Create button sits directly under the input, NOT pinned to the
  // bottom of a KeyboardAvoidingView: KAV's padding goes stale when the
  // connection banner appears mid-session (its layout shift isn't
  // re-measured), which left the bottom-pinned button hidden behind the
  // keyboard — untappable exactly when the user is offline.
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <NaturalLanguageInput
        value={text}
        onChange={setText}
        parsedResult={parsed}
        testID="quick-add-input"
      />
      <Pressable
        style={[
          styles.createButton,
          {
            backgroundColor: parsed.title.trim()
              ? colors.primary
              : colors.border,
          },
        ]}
        onPress={handleCreate}
        disabled={!parsed.title.trim()}
        accessibilityRole="button"
        accessibilityLabel="Create task"
        accessibilityState={{ disabled: !parsed.title.trim() }}
        testID="quick-add-submit"
      >
        <Text style={styles.createText}>Create Task</Text>
      </Pressable>
      <TipPopover
        visible={nlpTip.visible}
        title="Try natural language"
        message={'Type "Buy milk tomorrow !high p:Shopping"'}
        onDismiss={nlpTip.dismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  createButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  createText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
