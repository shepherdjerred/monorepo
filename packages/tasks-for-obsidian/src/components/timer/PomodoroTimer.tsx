import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSettings } from "../../hooks/use-settings";

type PomodoroTimerProps = {
  timeRemaining: number;
  type: "work" | "break";
  active: boolean;
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function PomodoroTimer({ timeRemaining, type, active }: PomodoroTimerProps) {
  const { colors } = useSettings();
  const ringColor = type === "work" ? colors.primary : colors.success;

  return (
    <View style={styles.container}>
      <View style={[styles.ring, { borderColor: active ? ringColor : colors.border }]}>
        <Text style={[styles.time, { color: colors.text }]}>
          {formatTime(timeRemaining)}
        </Text>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {type === "work" ? "Focus" : "Break"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    padding: 24,
  },
  ring: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  time: {
    fontSize: 48,
    fontWeight: "300",
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    marginTop: 4,
  },
});
