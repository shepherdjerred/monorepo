import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { Session } from "../types/generated";
import { BackendType, CheckStatus, ClaudeWorkingStatus, SessionStatus } from "../types/generated";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";
import { formatRelativeTime } from "../lib/utils";

type SessionCardProps = {
  session: Session;
  onPress: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete?: () => void;
  onRefresh?: () => void;
};

export function SessionCard({
  session,
  onPress,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  onRefresh,
}: SessionCardProps) {
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

      {/* Status indicators */}
      <View style={styles.statusIndicators}>
        {/* PR Status */}
        {session.pr_url && (
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>PR: </Text>
            {session.pr_check_status && (
              <View style={styles.checkStatusContainer}>
                <Text style={getCheckStatusStyle(session.pr_check_status)}>
                  {getCheckStatusSymbol(session.pr_check_status)}
                </Text>
                <Text style={[styles.statusValue, getCheckStatusTextStyle(session.pr_check_status)]}>
                  {session.pr_check_status}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Claude Working Status */}
        {session.claude_status !== ClaudeWorkingStatus.Unknown && (
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Claude: </Text>
            <Text style={[styles.statusValue, getClaudeStatusTextStyle(session.claude_status)]}>
              {getClaudeStatusText(session.claude_status)}
            </Text>
          </View>
        )}

        {/* Merge Conflict Warning */}
        {session.merge_conflict && (
          <View style={styles.statusRow}>
            <Text style={styles.conflictWarning}>⚠ Merge conflict with main</Text>
          </View>
        )}

        {/* Dirty Worktree Warning */}
        {session.worktree_dirty && (
          <View style={styles.statusRow}>
            <Text style={styles.dirtyWarning}>● Uncommitted changes</Text>
          </View>
        )}

        {/* Reconciliation Error */}
        {session.last_reconcile_error && (
          <View style={styles.reconcileError}>
            <Text style={styles.reconcileErrorTitle}>
              Reconcile error (attempt {session.reconcile_attempts})
            </Text>
            <Text style={styles.reconcileErrorMessage} numberOfLines={2}>
              {session.last_reconcile_error}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.timestamp}>
        {formatRelativeTime(new Date(session.created_at))}
      </Text>

      {/* Action buttons */}
      {(onEdit || onArchive || onUnarchive || onDelete || onRefresh) && (
        <View style={styles.actionRow}>
          {onRefresh && session.backend === BackendType.Docker && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
            >
              <Text style={styles.actionButtonText}>Refresh</Text>
            </TouchableOpacity>
          )}
          {onEdit && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Text style={styles.actionButtonText}>Edit</Text>
            </TouchableOpacity>
          )}
          {onArchive && session.status !== SessionStatus.Archived && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onArchive();
              }}
            >
              <Text style={styles.actionButtonText}>Archive</Text>
            </TouchableOpacity>
          )}
          {onUnarchive && session.status === SessionStatus.Archived && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onUnarchive();
              }}
            >
              <Text style={styles.actionButtonText}>Unarchive</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity
              style={[styles.actionButton, styles.deleteButton]}
              onPress={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Text style={[styles.actionButtonText, styles.deleteButtonText]}>
                Delete
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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

function getCheckStatusSymbol(status: CheckStatus): string {
  switch (status) {
    case CheckStatus.Passing:
    case CheckStatus.Mergeable:
    case CheckStatus.Merged:
      return "✓";
    case CheckStatus.Failing:
      return "✗";
    case CheckStatus.Pending:
      return "⏱";
  }
}

function getCheckStatusStyle(status: CheckStatus) {
  const baseStyle = { fontSize: typography.fontSize.sm, marginRight: 2 };
  switch (status) {
    case CheckStatus.Passing:
    case CheckStatus.Mergeable:
      return { ...baseStyle, color: "#22c55e" }; // green
    case CheckStatus.Merged:
      return { ...baseStyle, color: "#06b6d4" }; // cyan
    case CheckStatus.Failing:
      return { ...baseStyle, color: "#ef4444" }; // red
    case CheckStatus.Pending:
      return { ...baseStyle, color: "#eab308" }; // yellow
  }
}

function getCheckStatusTextStyle(status: CheckStatus) {
  switch (status) {
    case CheckStatus.Passing:
    case CheckStatus.Mergeable:
      return { color: "#22c55e" };
    case CheckStatus.Merged:
      return { color: "#06b6d4" };
    case CheckStatus.Failing:
      return { color: "#ef4444" };
    case CheckStatus.Pending:
      return { color: "#eab308" };
  }
}

function getClaudeStatusText(status: ClaudeWorkingStatus): string {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return "Working";
    case ClaudeWorkingStatus.WaitingApproval:
      return "Waiting for approval";
    case ClaudeWorkingStatus.WaitingInput:
      return "Waiting for input";
    case ClaudeWorkingStatus.Idle:
      return "Idle";
    default:
      return "Unknown";
  }
}

function getClaudeStatusTextStyle(status: ClaudeWorkingStatus) {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return { color: "#3b82f6" }; // blue
    case ClaudeWorkingStatus.WaitingApproval:
      return { color: "#a855f7" }; // purple
    case ClaudeWorkingStatus.WaitingInput:
      return { color: "#eab308" }; // yellow
    case ClaudeWorkingStatus.Idle:
      return { color: "#9ca3af" }; // gray
    default:
      return { color: colors.textLight };
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
  statusIndicators: {
    marginBottom: 8,
    gap: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  statusLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
    fontWeight: typography.fontWeight.medium,
  },
  statusValue: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
  },
  checkStatusContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  conflictWarning: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: "#ef4444", // red
    fontWeight: typography.fontWeight.bold,
  },
  dirtyWarning: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: "#f59e0b", // amber
    fontWeight: typography.fontWeight.medium,
  },
  reconcileError: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  reconcileErrorTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: "#ef4444",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  reconcileErrorMessage: {
    fontSize: typography.fontSize.xs,
    color: "#6b7280",
    fontFamily: typography.fontFamily.mono,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: colors.borderLight,
  },
  actionButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionButtonText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
    textTransform: "uppercase",
  },
  deleteButton: {
    backgroundColor: colors.error,
    borderColor: colors.border,
  },
  deleteButtonText: {
    color: colors.textWhite,
  },
});
