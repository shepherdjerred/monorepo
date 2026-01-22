import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import type { Session } from "../types/generated";
import {
  BackendType,
  CheckStatus,
  ClaudeWorkingStatus,
  SessionStatus,
  WorkflowStage,
  ReviewDecision,
} from "../types/generated";
import { useTheme } from "../contexts/ThemeContext";
import { typography } from "../styles/typography";
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

// Compute workflow stage from session state (mirrors Rust logic)
function getWorkflowStage(session: Session): WorkflowStage {
  // Check if PR is merged first
  if (session.pr_check_status === CheckStatus.Merged) {
    return WorkflowStage.Merged;
  }

  // No PR yet - still planning
  if (!session.pr_url) {
    return WorkflowStage.Planning;
  }

  // Check for blockers
  const ciBlocked = session.pr_check_status === CheckStatus.Failing;
  const conflictBlocked = session.merge_conflict;
  const changesRequested = session.pr_review_decision === ReviewDecision.ChangesRequested;

  if (ciBlocked || conflictBlocked || changesRequested) {
    return WorkflowStage.Blocked;
  }

  // Ready to merge
  const checksPass =
    session.pr_check_status === CheckStatus.Passing ||
    session.pr_check_status === CheckStatus.Mergeable;
  const approved = session.pr_review_decision === ReviewDecision.Approved;
  const noConflicts = !session.merge_conflict;

  if (checksPass && approved && noConflicts) {
    return WorkflowStage.ReadyToMerge;
  }

  // Waiting for review
  if (session.pr_review_decision === ReviewDecision.ReviewRequired || !session.pr_review_decision) {
    return WorkflowStage.Review;
  }

  return WorkflowStage.Implementation;
}

function getStageColor(stage: WorkflowStage): string {
  switch (stage) {
    case WorkflowStage.Planning:
      return "#3b82f6"; // blue
    case WorkflowStage.Implementation:
      return "#06b6d4"; // cyan
    case WorkflowStage.Review:
      return "#eab308"; // yellow
    case WorkflowStage.Blocked:
      return "#ef4444"; // red
    case WorkflowStage.ReadyToMerge:
      return "#22c55e"; // green
    case WorkflowStage.Merged:
      return "#9ca3af"; // gray
  }
}

function getStageLabel(stage: WorkflowStage): string {
  switch (stage) {
    case WorkflowStage.Planning:
      return "Plan";
    case WorkflowStage.Implementation:
      return "Impl";
    case WorkflowStage.Review:
      return "Review";
    case WorkflowStage.Blocked:
      return "Blocked";
    case WorkflowStage.ReadyToMerge:
      return "Ready";
    case WorkflowStage.Merged:
      return "Merged";
  }
}

export function SessionCard({
  session,
  onPress,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  onRefresh,
}: SessionCardProps) {
  const { colors } = useTheme();
  const statusColor = getStatusColor(session.status, colors);
  const themedStyles = getThemedStyles(colors);

  return (
    <TouchableOpacity style={themedStyles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Text style={[styles.name, { color: colors.textDark }]} numberOfLines={1}>
          {session.name}
        </Text>
        <View style={styles.badgesContainer}>
          {session.pr_url && (
            <View
              style={[
                styles.stageBadge,
                {
                  backgroundColor: getStageColor(getWorkflowStage(session)),
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.badgeText, { color: colors.textWhite }]}>
                {getStageLabel(getWorkflowStage(session))}
              </Text>
            </View>
          )}
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColor, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statusText, { color: colors.textWhite }]}>{session.status}</Text>
          </View>
        </View>
      </View>

      {session.repo_path && (
        <Text style={[styles.repoPath, { color: colors.textLight }]} numberOfLines={1}>
          {session.repo_path}
        </Text>
      )}

      {/* Status indicators */}
      <View style={styles.statusIndicators}>
        {/* PR Status */}
        {session.pr_url && (
          <View style={styles.statusRow}>
            <Text style={[styles.statusLabel, { color: colors.textLight }]}>PR: </Text>
            {session.pr_check_status && (
              <View style={styles.checkStatusContainer}>
                <Text style={getCheckStatusStyle(session.pr_check_status)}>
                  {getCheckStatusSymbol(session.pr_check_status)}
                </Text>
                <Text
                  style={[styles.statusValue, getCheckStatusTextStyle(session.pr_check_status)]}
                >
                  {session.pr_check_status}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Claude Working Status */}
        {session.claude_status !== ClaudeWorkingStatus.Unknown && (
          <View style={styles.statusRow}>
            <Text style={[styles.statusLabel, { color: colors.textLight }]}>Claude: </Text>
            <Text style={[styles.statusValue, getClaudeStatusTextStyle(session.claude_status)]}>
              {getClaudeStatusText(session.claude_status)}
            </Text>
          </View>
        )}

        {/* Merge Conflict Warning */}
        {session.merge_conflict && (
          <View style={styles.statusRow}>
            <Text style={[styles.conflictWarning, { color: colors.error }]}>
              ⚠ Merge conflict with main
            </Text>
          </View>
        )}

        {/* Dirty Worktree Warning */}
        {session.worktree_dirty && (
          <View style={styles.statusRow}>
            <Text style={[styles.dirtyWarning, { color: colors.warning }]}>
              ● Uncommitted changes
            </Text>
          </View>
        )}

        {/* Reconciliation Error */}
        {session.last_reconcile_error && (
          <View style={[styles.reconcileError, { borderColor: colors.error }]}>
            <Text style={[styles.reconcileErrorTitle, { color: colors.error }]}>
              Reconcile error (attempt {session.reconcile_attempts})
            </Text>
            <Text
              style={[styles.reconcileErrorMessage, { color: colors.textLight }]}
              numberOfLines={2}
            >
              {session.last_reconcile_error}
            </Text>
          </View>
        )}
      </View>

      <Text style={[styles.timestamp, { color: colors.textLight }]}>
        {formatRelativeTime(new Date(session.created_at))}
      </Text>

      {/* Action buttons */}
      {(onEdit || onArchive || onUnarchive || onDelete || onRefresh) && (
        <View style={[styles.actionRow, { borderTopColor: colors.borderLight }]}>
          {onRefresh && session.backend === BackendType.Docker && (
            <TouchableOpacity
              style={themedStyles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
            >
              <Text style={[styles.actionButtonText, { color: colors.textDark }]}>Refresh</Text>
            </TouchableOpacity>
          )}
          {onEdit && (
            <TouchableOpacity
              style={themedStyles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Text style={[styles.actionButtonText, { color: colors.textDark }]}>Edit</Text>
            </TouchableOpacity>
          )}
          {onArchive && session.status !== SessionStatus.Archived && (
            <TouchableOpacity
              style={themedStyles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onArchive();
              }}
            >
              <Text style={[styles.actionButtonText, { color: colors.textDark }]}>Archive</Text>
            </TouchableOpacity>
          )}
          {onUnarchive && session.status === SessionStatus.Archived && (
            <TouchableOpacity
              style={themedStyles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onUnarchive();
              }}
            >
              <Text style={[styles.actionButtonText, { color: colors.textDark }]}>Unarchive</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity
              style={[themedStyles.actionButton, { backgroundColor: colors.error }]}
              onPress={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Text style={[styles.actionButtonText, { color: colors.textWhite }]}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

type ThemeColors = {
  running: string;
  idle: string;
  completed: string;
  failed: string;
  archived: string;
  textLight: string;
  surface: string;
  border: string;
};

function getStatusColor(status: string, colors: ThemeColors): string {
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
      return { color: "#9ca3af" }; // gray
  }
}

function getThemedStyles(colors: { surface: string; border: string }) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 3,
      borderColor: colors.border,
      padding: 16,
      marginHorizontal: 16,
      marginBottom: 12,
      ...Platform.select({
        ios: {
          shadowColor: colors.border,
          shadowOffset: { width: 4, height: 4 },
          shadowOpacity: 1,
          shadowRadius: 0,
        },
        android: {
          elevation: 4,
        },
      }),
    },
    actionButton: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderWidth: 2,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
  });
}

const styles = StyleSheet.create({
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
    marginRight: 12,
  },
  badgesContainer: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
  },
  stageBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
  },
  badgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  statusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
  repoPath: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    marginBottom: 8,
  },
  timestamp: {
    fontSize: typography.fontSize.sm,
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
    fontWeight: typography.fontWeight.bold,
  },
  dirtyWarning: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    fontWeight: typography.fontWeight.medium,
  },
  reconcileError: {
    marginTop: 8,
    padding: 8,
    borderWidth: 1,
  },
  reconcileErrorTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  reconcileErrorMessage: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 2,
  },
  actionButtonText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: "uppercase",
  },
});
