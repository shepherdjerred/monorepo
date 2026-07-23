import React, { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon } from "../common/AppIcon";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { feedbackSelection } from "../../lib/feedback";
import {
  formatDate,
  nextMonday,
  nextSaturday,
  parseLocalDate,
  toISODate,
} from "../../lib/dates";
import { localTodayYmd } from "../../domain/recurrence";
import {
  type CalendarMonth,
  WEEKDAYS,
  addMonths,
  currentMonth,
  monthGrid,
  monthOf,
  monthTitle,
} from "../../lib/calendar";

const DOT_SLOTS = [0, 1, 2];

export type ScheduleField = "due" | "scheduled";

type Props = {
  visible: boolean;
  onClose: () => void;
  due?: string | undefined;
  scheduled?: string | undefined;
  initialField?: ScheduleField | undefined;
  /** Called once per pick; the sheet closes itself afterwards. */
  onApply: (field: ScheduleField, value: string | null) => void;
  /** Active-task count per YYYY-MM-DD, rendered as dots under calendar days. */
  dayCounts?: ReadonlyMap<string, number> | undefined;
};

function weekdayShort(ymd: string): string {
  return parseLocalDate(ymd).toLocaleDateString("en-US", { weekday: "short" });
}

export function ScheduleSheet({
  visible,
  onClose,
  due,
  scheduled,
  initialField,
  onApply,
  dayCounts,
}: Props) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const [field, setField] = useState<ScheduleField>(initialField ?? "due");
  const selected = field === "due" ? due : scheduled;
  const [month, setMonth] = useState<CalendarMonth>(currentMonth());

  const handleShow = useCallback(() => {
    const f = initialField ?? "due";
    setField(f);
    const value = f === "due" ? due : scheduled;
    setMonth(value ? monthOf(value) : currentMonth());
  }, [initialField, due, scheduled]);

  const today = localTodayYmd();
  const presets = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return [
      { key: "today", label: "Today", value: today },
      { key: "tomorrow", label: "Tomorrow", value: toISODate(tomorrow) },
      { key: "weekend", label: "This weekend", value: nextSaturday() },
      { key: "next-week", label: "Next week", value: nextMonday() },
    ];
  }, [today]);

  const apply = useCallback(
    (value: string | null) => {
      feedbackSelection();
      onApply(field, value);
      onClose();
    },
    [field, onApply, onClose],
  );

  const switchField = useCallback(
    (f: ScheduleField) => {
      feedbackSelection();
      setField(f);
      const value = f === "due" ? due : scheduled;
      if (value) setMonth(monthOf(value));
    },
    [due, scheduled],
  );

  const weeks = useMemo(() => monthGrid(month), [month]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "fade" : "slide"}
      onRequestClose={onClose}
      onShow={handleShow}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Close schedule sheet"
      />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
          testID="schedule-sheet"
        >
          <View style={styles.grabberRow}>
            <View
              style={[styles.grabber, { backgroundColor: colors.textTertiary }]}
            />
          </View>

          <View style={styles.fieldRow}>
            {(["due", "scheduled"] as const).map((f) => {
              const active = field === f;
              const value = f === "due" ? due : scheduled;
              return (
                <Pressable
                  key={f}
                  style={[
                    styles.fieldTab,
                    {
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => {
                    switchField(f);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Edit ${f} date`}
                  testID={`schedule-field-${f}`}
                >
                  <Text
                    style={[
                      styles.fieldTabLabel,
                      { color: active ? "#ffffff" : colors.text },
                    ]}
                  >
                    {f === "due" ? "Due" : "Scheduled"}
                  </Text>
                  <Text
                    style={[
                      typography.caption,
                      { color: active ? "#ffffff" : colors.textSecondary },
                    ]}
                  >
                    {value ? formatDate(value) : "None"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.presets}>
            {presets.map((preset) => (
              <Pressable
                key={preset.key}
                style={[
                  styles.presetRow,
                  { borderBottomColor: colors.borderLight },
                ]}
                onPress={() => {
                  apply(preset.value);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${preset.label}, ${weekdayShort(preset.value)} ${formatDate(preset.value)}`}
                testID={`schedule-preset-${preset.key}`}
              >
                <Text style={[typography.body, { color: colors.text }]}>
                  {preset.label}
                </Text>
                <Text
                  style={[
                    typography.bodySmall,
                    { color: colors.textSecondary },
                  ]}
                >
                  {weekdayShort(preset.value)} {formatDate(preset.value)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[
                styles.presetRow,
                { borderBottomColor: colors.borderLight },
              ]}
              onPress={() => {
                apply(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${field} date`}
              testID="schedule-clear"
            >
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                No date
              </Text>
              <AppIcon name="x" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.monthHeader}>
            <Pressable
              onPress={() => {
                setMonth((m) => addMonths(m, -1));
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              testID="schedule-prev-month"
            >
              <AppIcon name="chevron-left" size={22} color={colors.text} />
            </Pressable>
            <Text style={[typography.subheading, { color: colors.text }]}>
              {monthTitle(month)}
            </Text>
            <Pressable
              onPress={() => {
                setMonth((m) => addMonths(m, 1));
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              testID="schedule-next-month"
            >
              <AppIcon name="chevron-right" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((weekday) => (
              <Text
                key={weekday.key}
                style={[
                  typography.caption,
                  styles.weekdayLabel,
                  { color: colors.textTertiary },
                ]}
              >
                {weekday.label}
              </Text>
            ))}
          </View>

          {weeks.map((week) => (
            <View key={week[0]?.key} style={styles.weekRow}>
              {week.map((cell) => {
                if (cell.ymd === null) {
                  return <View key={cell.key} style={styles.dayCell} />;
                }
                const day = cell.ymd;
                const isSelected = day === selected;
                const isToday = day === today;
                const count = dayCounts?.get(day) ?? 0;
                return (
                  <Pressable
                    key={cell.key}
                    style={styles.dayCell}
                    onPress={() => {
                      apply(day);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${weekdayShort(day)} ${formatDate(day)}${count > 0 ? `, ${count} task${count === 1 ? "" : "s"}` : ""}`}
                    testID={`schedule-day-${day}`}
                  >
                    <View
                      style={[
                        styles.dayCircle,
                        isSelected && { backgroundColor: colors.primary },
                        !isSelected &&
                          isToday && {
                            borderWidth: 1.5,
                            borderColor: colors.primary,
                          },
                      ]}
                    >
                      <Text
                        style={[
                          typography.bodySmall,
                          {
                            color: isSelected
                              ? "#ffffff"
                              : isToday
                                ? colors.primary
                                : colors.text,
                          },
                        ]}
                      >
                        {Number(day.slice(8))}
                      </Text>
                    </View>
                    <View style={styles.dotRow}>
                      {DOT_SLOTS.filter((slot) => slot < count).map((slot) => (
                        <View
                          key={slot}
                          style={[
                            styles.dot,
                            {
                              backgroundColor: isSelected
                                ? colors.primary
                                : colors.textTertiary,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheetWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
  },
  grabberRow: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    opacity: 0.4,
  },
  fieldRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  fieldTab: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    alignItems: "center",
    gap: 1,
  },
  fieldTabLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  presets: {
    marginTop: 8,
  },
  presetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  monthHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  weekdayRow: {
    flexDirection: "row",
  },
  weekdayLabel: {
    flex: 1,
    textAlign: "center",
    paddingVertical: 4,
  },
  weekRow: {
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 3,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  dotRow: {
    flexDirection: "row",
    gap: 2,
    height: 4,
    marginTop: 1,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
});
