import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSettings } from "../../hooks/useSettings";
import { formatDuration } from "../../lib/utils";

type TimeTrackingBarProps = {
  taskTitle: string;
  duration: number;
  onStop: () => void;
};

export function TimeTrackingBar({ taskTitle, duration, onStop }: TimeTrackingBarProps) {
  const { colors } = useSettings();

  return (
    <View style={[styles.bar, { backgroundColor: colors.primary }]}>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {taskTitle}
        </Text>
        <Text style={styles.duration}>{formatDuration(duration)}</Text>
      </View>
      <Pressable style={styles.stopButton} onPress={onStop}>
        <Text style={styles.stopText}>Stop</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  info: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  duration: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  stopButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 4,
    marginLeft: 8,
  },
  stopText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
});
