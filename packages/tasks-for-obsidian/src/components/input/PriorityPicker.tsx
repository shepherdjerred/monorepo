import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import type { Priority } from "../../domain/priority";
import { ALL_PRIORITIES, PRIORITY_COLORS, PRIORITY_LABELS } from "../../domain/priority";
import { feedbackSelection } from "../../lib/feedback";

type PriorityPickerProps = {
  value: Priority;
  onChange: (p: Priority) => void;
};

export function PriorityPicker({ value, onChange }: PriorityPickerProps) {
  return (
    <View style={styles.container}>
      {ALL_PRIORITIES.map((p) => {
        const selected = p === value;
        const color = PRIORITY_COLORS[p];
        return (
          <Pressable
            key={p}
            style={[
              styles.option,
              { borderColor: color },
              selected && { backgroundColor: color },
            ]}
            onPress={() => {
              feedbackSelection();
              onChange(p);
            }}
          >
            <Text
              style={[
                styles.label,
                { color: selected ? "#ffffff" : color },
              ]}
            >
              {PRIORITY_LABELS[p]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
});
