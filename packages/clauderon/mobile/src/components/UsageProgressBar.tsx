import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { UsageWindow } from "../types/generated";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";

type UsageProgressBarProps = {
  window: UsageWindow;
  title: string;
  subtitle?: string;
};

function getBarColor(utilization: number): string {
  if (utilization < 0.5) return colors.success;
  if (utilization < 0.8) return colors.warning;
  return colors.error;
}

export function UsageProgressBar({
  window,
  title,
  subtitle,
}: UsageProgressBarProps) {
  const percentage = Math.min(window.utilization * 100, 100);
  const barColor = getBarColor(window.utilization);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.count}>
          {window.current} / {window.limit}
        </Text>
      </View>

      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <View style={styles.progressContainer}>
        <View
          style={[
            styles.progressBar,
            { width: `${percentage}%`, backgroundColor: barColor },
          ]}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.percentage}>{percentage.toFixed(1)}%</Text>
        {window.resets_at && (
          <Text style={styles.resetTime}>
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
    color: colors.textDark,
    textTransform: "uppercase",
  },
  count: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
    marginBottom: 4,
  },
  progressContainer: {
    height: 16,
    backgroundColor: colors.borderLight,
    borderWidth: 2,
    borderColor: colors.border,
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
    color: colors.textDark,
  },
  resetTime: {
    fontSize: typography.fontSize.xs,
    color: colors.textLight,
  },
});
