import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useReducedMotion,
} from "react-native-reanimated";
import * as DropdownMenu from "zeego/dropdown-menu";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FeatherIconName } from "@react-native-vector-icons/feather";
import { AppIcon } from "../common/AppIcon";
import type { Priority } from "../../domain/priority";
import { ALL_PRIORITIES, PRIORITY_LABELS } from "../../domain/priority";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { ScheduleSheet, type ScheduleField } from "../input/ScheduleSheet";

type Props = {
  count: number;
  onSchedule: (field: ScheduleField, value: string | null) => void;
  onComplete: () => void;
  onDelete: () => void;
  onSetPriority: (priority: Priority) => void;
  onDone: () => void;
  dayCounts?: ReadonlyMap<string, number> | undefined;
};

function BarButton({
  icon,
  label,
  color,
  onPress,
  disabled,
  testID,
}: {
  icon: FeatherIconName;
  label: string;
  color: string;
  onPress?: (() => void) | undefined;
  disabled?: boolean | undefined;
  testID?: string | undefined;
}) {
  const content = (
    <>
      <View style={{ opacity: disabled ? 0.4 : 1 }}>
        <AppIcon name={icon} size={20} color={color} />
      </View>
      <Text
        style={[typography.caption, { color, opacity: disabled ? 0.4 : 1 }]}
      >
        {label}
      </Text>
    </>
  );
  if (!onPress) return <View style={styles.barButton}>{content}</View>;
  return (
    <Pressable
      style={styles.barButton}
      onPress={onPress}
      disabled={disabled ?? false}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled ?? false }}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

/**
 * Bottom action bar for multi-select mode: Schedule / Priority / Complete /
 * Delete applied to the current selection, plus Done to exit.
 */
export function BulkActionBar({
  count,
  onSchedule,
  onComplete,
  onDelete,
  onSetPriority,
  onDone,
  dayCounts,
}: Props) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [sheetOpen, setSheetOpen] = useState(false);

  const none = count === 0;

  return (
    <Animated.View
      entering={
        reducedMotion
          ? FadeIn.duration(150)
          : SlideInDown.springify().damping(15)
      }
      exiting={
        reducedMotion ? FadeOut.duration(100) : SlideOutDown.duration(200)
      }
      style={[
        styles.bar,
        {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
      testID="bulk-action-bar"
    >
      <View style={styles.countRow}>
        <Text style={[typography.subheading, { color: colors.text }]}>
          {count} selected
        </Text>
        <Pressable
          onPress={onDone}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Done selecting"
          testID="bulk-done"
        >
          <Text style={[typography.body, { color: colors.primary }]}>Done</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        <BarButton
          icon="calendar"
          label="Schedule"
          color={colors.text}
          disabled={none}
          onPress={() => {
            setSheetOpen(true);
          }}
          testID="bulk-schedule"
        />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <BarButton
              icon="flag"
              label="Priority"
              color={colors.text}
              disabled={none}
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            {ALL_PRIORITIES.map((p) => (
              <DropdownMenu.Item
                key={p}
                onSelect={() => {
                  onSetPriority(p);
                }}
              >
                <DropdownMenu.ItemTitle>
                  {PRIORITY_LABELS[p]}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        <BarButton
          icon="check"
          label="Complete"
          color={colors.success}
          disabled={none}
          onPress={onComplete}
          testID="bulk-complete"
        />
        <BarButton
          icon="trash-2"
          label="Delete"
          color={colors.error}
          disabled={none}
          onPress={onDelete}
          testID="bulk-delete"
        />
      </View>
      <ScheduleSheet
        visible={sheetOpen}
        dayCounts={dayCounts}
        onClose={() => {
          setSheetOpen(false);
        }}
        onApply={(field, value) => {
          onSchedule(field, value);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  countRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  barButton: {
    alignItems: "center",
    gap: 2,
    minWidth: 64,
    paddingVertical: 4,
  },
});
