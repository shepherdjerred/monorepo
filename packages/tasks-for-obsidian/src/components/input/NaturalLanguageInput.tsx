import React from "react";
import { View, TextInput, Text, StyleSheet } from "react-native";
import type { NlpParseResult } from "../../domain/types";
import { PRIORITY_LABELS } from "../../domain/priority";
import { useSettings } from "../../hooks/use-settings";

type NaturalLanguageInputProps = {
  value: string;
  onChange: (text: string) => void;
  parsedResult?: NlpParseResult;
};

export function NaturalLanguageInput({
  value,
  onChange,
  parsedResult,
}: NaturalLanguageInputProps) {
  const { colors } = useSettings();

  const badges: string[] = [];
  if (parsedResult?.due) badges.push(parsedResult.due);
  if (parsedResult?.priority) badges.push(PRIORITY_LABELS[parsedResult.priority]);
  if (parsedResult?.projects) {
    for (const p of parsedResult.projects) badges.push(p);
  }
  if (parsedResult?.contexts) {
    for (const c of parsedResult.contexts) badges.push(`@${c}`);
  }
  if (parsedResult?.tags) {
    for (const t of parsedResult.tags) badges.push(`#${t}`);
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
        value={value}
        onChangeText={onChange}
        placeholder="Buy groceries #shopping @errands !high tomorrow"
        placeholderTextColor={colors.textTertiary}
        autoFocus
      />
      {badges.length > 0 ? (
        <View style={styles.badges}>
          {badges.map((badge, i) => (
            <View
              key={`${badge}-${i}`}
              style={[styles.badge, { backgroundColor: colors.primaryLight }]}
            >
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  input: {
    fontSize: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
});
