import React from "react";
import { Pressable, Text, View } from "react-native";
import { MenuView, type MenuAction } from "@react-native-menu/menu";

import {
  ALL_PRIORITIES,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
} from "../../domain/priority";
import type { Priority } from "../../domain/priority";
import {
  RECURRENCE_OPTIONS,
  recurrenceOptionForId,
  recurrenceOptionForRule,
  recurrenceRuleLabel,
} from "../../domain/recurrence-options";
import { useSettings } from "../../hooks/use-settings";
import { feedbackSelection } from "../../lib/feedback";
import { typography } from "../../styles/typography";
import { AppIcon } from "../common/AppIcon";
import { taskDetailStyles as styles } from "./task-detail-styles";

export function SectionTitle({ children }: { readonly children: string }) {
  const { colors } = useSettings();
  return (
    <Text
      style={[
        typography.label,
        styles.sectionTitle,
        { color: colors.textSecondary },
      ]}
    >
      {children}
    </Text>
  );
}

export function Divider({ color }: { readonly color: string }) {
  return <View style={[styles.divider, { backgroundColor: color }]} />;
}

export function ActionRow({
  icon,
  label,
  value,
  tint,
  disabled,
  onPress,
  testID,
}: {
  readonly icon: "check-circle" | "circle" | "pause-circle" | "play-circle";
  readonly label: string;
  readonly value: string;
  readonly tint: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { colors } = useSettings();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionRow,
        { opacity: disabled ? 0.45 : pressed ? 0.6 : 1 },
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      testID={testID}
    >
      <View style={styles.rowLabelGroup}>
        <AppIcon name={icon} size={20} color={tint} />
        <Text style={[typography.body, { color: tint }]}>{label}</Text>
      </View>
      <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
        {value}
      </Text>
    </Pressable>
  );
}

export function MetadataButton({
  icon,
  label,
  value,
  onPress,
  testID,
}: {
  readonly icon: "calendar" | "flag";
  readonly label: string;
  readonly value: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { colors } = useSettings();
  return (
    <Pressable
      style={({ pressed }) => [styles.formRow, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={`Choose ${label.toLowerCase()} date`}
      testID={testID}
    >
      <View style={styles.rowLabelGroup}>
        <AppIcon name={icon} size={19} color={colors.textSecondary} />
        <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
      </View>
      <View style={styles.rowValueGroup}>
        <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
          {value}
        </Text>
        <AppIcon name="chevron-right" size={16} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

export function PriorityMenuRow({
  value,
  onChange,
}: {
  readonly value: Priority;
  readonly onChange: (priority: Priority) => void;
}) {
  const { colors } = useSettings();
  const actions: MenuAction[] = ALL_PRIORITIES.map((priority) => ({
    id: priority,
    title: PRIORITY_LABELS[priority],
    image: "flag",
    state: priority === value ? "on" : "off",
  }));

  return (
    <MenuView
      style={styles.menu}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        const priority = ALL_PRIORITIES.find(
          (candidate) => candidate === nativeEvent.event,
        );
        if (priority === undefined) {
          throw new Error(`Unknown priority menu action: ${nativeEvent.event}`);
        }
        feedbackSelection();
        onChange(priority);
      }}
      testID="task-detail-priority-menu"
    >
      <View
        style={styles.formRow}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Priority: ${PRIORITY_LABELS[value]}`}
        accessibilityHint="Opens priority menu"
      >
        <View style={styles.rowLabelGroup}>
          <AppIcon name="flag" size={19} color={PRIORITY_COLORS[value]} />
          <Text style={[typography.body, { color: colors.text }]}>
            Priority
          </Text>
        </View>
        <View style={styles.rowValueGroup}>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
            {PRIORITY_LABELS[value]}
          </Text>
          <AppIcon name="chevron-right" size={16} color={colors.textTertiary} />
        </View>
      </View>
    </MenuView>
  );
}

export function RecurrenceMenuRow({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (recurrence: string) => void;
}) {
  const { colors } = useSettings();
  const selectedOption = recurrenceOptionForRule(value);
  const actions: MenuAction[] = RECURRENCE_OPTIONS.map((option) => ({
    id: option.id,
    title: option.label,
    image: option.rule.length === 0 ? "repeat.slash" : "repeat",
    state: option.rule === value ? "on" : "off",
  }));
  if (selectedOption === undefined && value.length > 0) {
    actions.unshift({
      id: "custom",
      title: "Custom rule from Obsidian",
      image: "repeat",
      state: "on",
      attributes: { disabled: true },
    });
  }

  return (
    <MenuView
      style={styles.menu}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        const option = recurrenceOptionForId(nativeEvent.event);
        if (option === undefined) {
          throw new Error(
            `Unknown recurrence menu action: ${nativeEvent.event}`,
          );
        }
        feedbackSelection();
        onChange(option.rule);
      }}
      testID="task-detail-recurrence-menu"
    >
      <View
        style={styles.formRow}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Repeat: ${recurrenceRuleLabel(value)}`}
        accessibilityHint="Opens repeat schedule menu"
      >
        <View style={styles.rowLabelGroup}>
          <AppIcon name="repeat" size={19} color={colors.textSecondary} />
          <Text style={[typography.body, { color: colors.text }]}>Repeat</Text>
        </View>
        <View style={styles.rowValueGroup}>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
            {recurrenceRuleLabel(value)}
          </Text>
          <AppIcon name="chevron-right" size={16} color={colors.textTertiary} />
        </View>
      </View>
    </MenuView>
  );
}

export function AnchorOption({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const { colors } = useSettings();
  return (
    <Pressable
      style={[
        styles.anchorOption,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary : colors.background,
        },
      ]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text
        style={[
          typography.bodySmall,
          { color: selected ? "#ffffff" : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ReadOnlyRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  const { colors } = useSettings();
  return (
    <View
      style={styles.formRow}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
      <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
        {value}
      </Text>
    </View>
  );
}
