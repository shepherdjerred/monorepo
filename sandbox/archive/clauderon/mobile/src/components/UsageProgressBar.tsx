import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { UsageWindow } from "../types/generated";
import { useTheme } from "../contexts/ThemeContext";
import { typography } from "../styles/typography";

type UsageProgressBarProps = {
  window: UsageWindow;
  title: string;
  subtitle?: string;
};

export function UsageProgressBar({ window, title, subtitle }: UsageProgressBarProps) {
  const { colors } = useTheme();
  const percentage = Math.min(window.utilization * 100, 100);

  const getBarColor = (utilization: number): string => {
    if (utilization < 0.5) return colors.success;
    if (utilization < 0.8) return colors.warning;
    return colors.error;
  };

  const barColor = getBarColor(window.utilization);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textDark }]}>{title}</Text>
        <Text style={[styles.count, { color: colors.textLight }]}>
          {window.current} / {window.limit}
        </Text>
      </View>

      {subtitle && <Text style={[styles.subtitle, { color: colors.textLight }]}>{subtitle}</Text>}

      <View
        style={[
          styles.progressContainer,
          { backgroundColor: colors.borderLight, borderColor: colors.border },
        ]}
      >
        <View
          style={[styles.progressBar, { width: `${percentage}%`, backgroundColor: barColor }]}
        />
      </View>

      <View style={styles.footer}>
        <Text style={[styles.percentage, { color: colors.textDark }]}>
          {percentage.toFixed(1)}%
        </Text>
        {window.resets_at && (
          <Text style={[styles.resetTime, { color: colors.textLight }]}>
            Resets: {new Date(window.resets_at).toLocaleString()}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  count: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    marginBottom: 4,
  },
  progressContainer: {
    height: 16,
    borderWidth: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  percentage: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
  },
  resetTime: {
    fontSize: typography.fontSize.xs,
  },
});
