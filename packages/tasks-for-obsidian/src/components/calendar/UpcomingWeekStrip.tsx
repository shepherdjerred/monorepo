import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { UpcomingWeekDay } from "../../domain/agenda";
import { useSettings } from "../../hooks/use-settings";
import { formatAgendaDayHeading, parseLocalDate } from "../../lib/dates";
import { typography } from "../../styles/typography";

type UpcomingWeekStripProps = {
  days: readonly UpcomingWeekDay[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  onToday: () => void;
};

export function UpcomingWeekStrip({
  days,
  selectedDay,
  onSelectDay,
  onToday,
}: UpcomingWeekStripProps) {
  const { colors } = useSettings();

  return (
    <View style={[styles.container, { borderBottomColor: colors.borderLight }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Pressable
          style={styles.todayButton}
          onPress={onToday}
          accessibilityRole="button"
          accessibilityLabel="Go to Today"
        >
          <Text style={[typography.bodySmall, { color: colors.primary }]}>
            Today
          </Text>
        </Pressable>
        <DayButton
          label="All"
          accessibilityLabel="Show all upcoming tasks"
          selected={selectedDay === null}
          onPress={() => {
            onSelectDay(null);
          }}
        />
        {days.map(({ day, count }) => {
          const date = parseLocalDate(day);
          return (
            <DayButton
              key={day}
              label={date.toLocaleDateString("en-US", { weekday: "narrow" })}
              dayNumber={String(date.getDate())}
              count={count}
              accessibilityLabel={`${formatAgendaDayHeading(day)}, ${String(count)} task${count === 1 ? "" : "s"}`}
              selected={selectedDay === day}
              onPress={() => {
                onSelectDay(selectedDay === day ? null : day);
              }}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function DayButton({
  label,
  dayNumber,
  count,
  selected,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  dayNumber?: string | undefined;
  count?: number | undefined;
  selected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { colors } = useSettings();
  const foreground = selected ? colors.textInverse : colors.text;

  return (
    <Pressable
      style={[
        styles.day,
        {
          backgroundColor: selected ? colors.primary : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
    >
      <Text style={[typography.caption, { color: foreground }]}>{label}</Text>
      {dayNumber === undefined ? null : (
        <Text style={[typography.bodySmall, { color: foreground }]}>
          {dayNumber}
        </Text>
      )}
      {count === undefined || count === 0 ? null : (
        <View
          style={[
            styles.count,
            {
              backgroundColor: selected ? colors.textInverse : colors.primary,
            },
          ]}
        >
          <Text
            style={[
              styles.countText,
              { color: selected ? colors.primary : colors.textInverse },
            ]}
          >
            {count > 9 ? "9+" : String(count)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  todayButton: {
    minWidth: 52,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  day: {
    minWidth: 48,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  count: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  countText: {
    fontSize: 10,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
