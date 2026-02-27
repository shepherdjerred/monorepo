import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { useSettings } from "../../hooks/use-settings";
import { formatDate } from "../../lib/dates";

export type DatePickerProps = {
  value?: string | undefined;
  onChange: (date?: string) => void;
};

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const PRESETS = [
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
  { label: "Next Week", offset: 7 },
] as const;

export function DatePicker({ value, onChange }: DatePickerProps) {
  const { colors } = useSettings();

  const handlePreset = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    onChange(toISODate(date));
  };

  return (
    <View style={styles.container}>
      <View style={styles.presets}>
        {PRESETS.map((preset) => (
          <Pressable
            key={preset.label}
            style={[styles.preset, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => { handlePreset(preset.offset); }}
          >
            <Text style={[styles.presetText, { color: colors.text }]}>
              {preset.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.preset, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => { onChange(); }}
        >
          <Text style={[styles.presetText, { color: colors.textSecondary }]}>
            None
          </Text>
        </Pressable>
      </View>
      {value ? (
        <Text style={[styles.selected, { color: colors.primary }]}>
          {formatDate(value)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  presets: {
    flexDirection: "row",
    gap: 8,
  },
  preset: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  presetText: {
    fontSize: 13,
    fontWeight: "500",
  },
  selected: {
    fontSize: 14,
    fontWeight: "600",
  },
});
