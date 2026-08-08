import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AppearancePreference } from "../../styles/appearance";
import type { Colors } from "../../styles/colors";
import { controlSize, radii, separator, spacing } from "../../styles/tokens";
import { dynamicTypeRamps, typography } from "../../styles/typography";

const APPEARANCE_OPTIONS: readonly {
  value: AppearancePreference;
  label: string;
  description: string;
}[] = [
  {
    value: "system",
    label: "System",
    description: "Matches your device appearance",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light appearance",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark appearance",
  },
];

type AppearancePickerProps = {
  appearance: AppearancePreference;
  colors: Colors;
  onChange: (appearance: AppearancePreference) => Promise<void>;
};

export function AppearancePicker({
  appearance,
  colors,
  onChange,
}: AppearancePickerProps) {
  return (
    <View
      style={[
        styles.group,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
      accessibilityRole="radiogroup"
      accessibilityLabel="Appearance"
    >
      {APPEARANCE_OPTIONS.map((option, index) => {
        const selected = appearance === option.value;
        return (
          <Pressable
            key={option.value}
            style={({ pressed }) => [
              styles.option,
              index < APPEARANCE_OPTIONS.length - 1 && {
                borderBottomColor: colors.divider,
                borderBottomWidth: separator.hairline,
              },
              pressed && { backgroundColor: colors.borderLight },
            ]}
            onPress={() => {
              void onChange(option.value);
            }}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityHint={option.description}
            accessibilityState={{ checked: selected }}
            testID={`settings-appearance-${option.value}`}
          >
            <View style={styles.copy}>
              <Text
                style={[typography.body, { color: colors.text }]}
                dynamicTypeRamp={dynamicTypeRamps.body}
              >
                {option.label}
              </Text>
              <Text
                style={[typography.bodySmall, { color: colors.textSecondary }]}
                dynamicTypeRamp={dynamicTypeRamps.bodySmall}
              >
                {option.description}
              </Text>
            </View>
            <View
              style={[
                styles.selectionRing,
                {
                  borderColor: selected ? colors.primary : colors.textTertiary,
                },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {selected ? (
                <View
                  style={[
                    styles.selectionDot,
                    { backgroundColor: colors.primary },
                  ]}
                />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radii.medium,
    borderWidth: separator.hairline,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  option: {
    minHeight: controlSize.minimumHitTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  copy: {
    flex: 1,
  },
  selectionRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
