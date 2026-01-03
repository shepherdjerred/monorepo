import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { Session } from "../types/generated";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";
import { formatRelativeTime } from "../lib/utils";

type SessionCardProps = {
  session: Session;
  onPress: () => void;
};

export function SessionCard({ session, onPress }: SessionCardProps) {
  const statusColor = getStatusColor(session.status);

  return (
    <TouchableOpacity
      style={[commonStyles.card, styles.card]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {session.name}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>{session.status}</Text>
        </View>
      </View>

      {session.repo_path && (
        <Text style={styles.repoPath} numberOfLines={1}>
          {session.repo_path}
        </Text>
      )}

      <Text style={styles.timestamp}>
        {formatRelativeTime(new Date(session.created_at))}
      </Text>
    </TouchableOpacity>
  );
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "running":
      return colors.running;
    case "idle":
      return colors.idle;
    case "completed":
      return colors.completed;
    case "failed":
      return colors.failed;
    case "archived":
      return colors.archived;
    default:
      return colors.textLight;
  }
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  name: {
    flex: 1,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    marginRight: 12,
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: colors.border,
  },
  statusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  repoPath: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
    marginBottom: 8,
  },
  timestamp: {
    fontSize: typography.fontSize.sm,
    color: colors.textLight,
  },
});
