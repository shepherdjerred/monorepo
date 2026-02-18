import type { Session, ResourceState } from "@clauderon/client";
import {
  SessionStatus,
  CheckStatus,
  ClaudeWorkingStatus,
  WorkflowStage,
  ReviewDecision,
} from "@clauderon/shared";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  User,
  Circle,
} from "lucide-react";

// Helper function to map git status codes to readable labels
export function getStatusLabel(status: string): string {
  const code = status.trim();
  if (code.startsWith("M")) {
    return "Modified";
  }
  if (code.startsWith("A")) {
    return "Added";
  }
  if (code.startsWith("D")) {
    return "Deleted";
  }
  if (code.startsWith("R")) {
    return "Renamed";
  }
  if (code.startsWith("C")) {
    return "Copied";
  }
  if (code.startsWith("U")) {
    return "Unmerged";
  }
  if (code.startsWith("?")) {
    return "Untracked";
  }
  return "Changed";
}

export function shouldSpanWide(session: Session): boolean {
  return (
    session.status === SessionStatus.Running ||
    (session.pr_url != null && session.pr_check_status != null) ||
    session.claude_status === ClaudeWorkingStatus.Working ||
    session.claude_status === ClaudeWorkingStatus.WaitingApproval ||
    session.claude_status === ClaudeWorkingStatus.WaitingInput ||
    session.merge_conflict ||
    session.worktree_dirty
  );
}

export function getWorkflowStage(session: Session): WorkflowStage {
  if (session.pr_check_status === CheckStatus.Merged) {
    return WorkflowStage.Merged;
  }

  if (session.pr_url == null || session.pr_url.length === 0) {
    return WorkflowStage.Planning;
  }

  const ciBlocked = session.pr_check_status === CheckStatus.Failing;
  const conflictBlocked = session.merge_conflict;
  const changesRequested =
    session.pr_review_decision === ReviewDecision.ChangesRequested;

  if (ciBlocked || conflictBlocked || changesRequested) {
    return WorkflowStage.Blocked;
  }

  const checksPass =
    session.pr_check_status === CheckStatus.Passing ||
    session.pr_check_status === CheckStatus.Mergeable;
  const approved = session.pr_review_decision === ReviewDecision.Approved;
  const noConflicts = !session.merge_conflict;

  if (checksPass && approved && noConflicts) {
    return WorkflowStage.ReadyToMerge;
  }

  if (
    session.pr_review_decision === ReviewDecision.ReviewRequired ||
    session.pr_review_decision == null
  ) {
    return WorkflowStage.Review;
  }

  return WorkflowStage.Implementation;
}

export function getStageColor(stage: WorkflowStage): string {
  switch (stage) {
    case WorkflowStage.Planning:
      return "bg-blue-500";
    case WorkflowStage.Implementation:
      return "bg-cyan-500";
    case WorkflowStage.Review:
      return "bg-yellow-500";
    case WorkflowStage.Blocked:
      return "bg-red-500";
    case WorkflowStage.ReadyToMerge:
      return "bg-green-500";
    case WorkflowStage.Merged:
      return "bg-gray-500";
    default:
      return "bg-gray-500";
  }
}

export function getHealthDisplay(state: ResourceState): {
  label: string;
  className: string;
  tooltip: string;
} {
  switch (state.type) {
    case "Healthy":
      return {
        label: "OK",
        className: "bg-green-500/20 text-green-700 border-green-500/50",
        tooltip: "Backend is running and healthy",
      };
    case "Stopped":
      return {
        label: "Stopped",
        className: "bg-yellow-500/20 text-yellow-700 border-yellow-500/50",
        tooltip: "Container stopped - can be started or recreated",
      };
    case "Hibernated":
      return {
        label: "Hibernated",
        className: "bg-blue-500/20 text-blue-700 border-blue-500/50",
        tooltip: "Sprite is hibernated - can be woken",
      };
    case "Pending":
      return {
        label: "Pending",
        className: "bg-yellow-500/20 text-yellow-700 border-yellow-500/50",
        tooltip: "Pod is pending - waiting for resources",
      };
    case "Missing":
      return {
        label: "Missing",
        className: "bg-orange-500/20 text-orange-700 border-orange-500/50",
        tooltip: "Backend resource missing - can be recreated",
      };
    case "Error":
      return {
        label: "Error",
        className: "bg-red-500/20 text-red-700 border-red-500/50",
        tooltip: `Backend error: ${state.content.message}`,
      };
    case "CrashLoop":
      return {
        label: "Crash Loop",
        className: "bg-red-500/20 text-red-700 border-red-500/50",
        tooltip: "Pod is in CrashLoopBackOff",
      };
    case "DeletedExternally":
      return {
        label: "Deleted",
        className: "bg-red-500/20 text-red-700 border-red-500/50",
        tooltip: "Backend was deleted outside of clauderon",
      };
    case "DataLost":
      return {
        label: "Data Lost",
        className: "bg-red-500/20 text-red-700 border-red-500/50",
        tooltip: `Data lost: ${state.content.reason}`,
      };
    case "WorktreeMissing":
      return {
        label: "Worktree Missing",
        className: "bg-red-500/20 text-red-700 border-red-500/50",
        tooltip: "Git worktree was deleted",
      };
    default:
      return {
        label: "Unknown",
        className: "bg-gray-500/20 text-gray-700 border-gray-500/50",
        tooltip: "Unknown health state",
      };
  }
}

export function getCheckStatusColor(status: CheckStatus): string {
  switch (status) {
    case CheckStatus.Passing:
    case CheckStatus.Mergeable:
    case CheckStatus.Merged:
      return "text-green-500";
    case CheckStatus.Failing:
      return "text-red-500";
    case CheckStatus.Pending:
      return "text-yellow-500";
    default:
      return "text-gray-500";
  }
}

export function getCheckStatusIcon(status: CheckStatus) {
  switch (status) {
    case CheckStatus.Passing:
    case CheckStatus.Mergeable:
    case CheckStatus.Merged:
      return <CheckCircle2 className="w-3 h-3" />;
    case CheckStatus.Failing:
      return <XCircle className="w-3 h-3" />;
    case CheckStatus.Pending:
      return <Clock className="w-3 h-3" />;
    default:
      return <Circle className="w-3 h-3" />;
  }
}

export function getClaudeStatusIcon(status: ClaudeWorkingStatus) {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return <Loader2 className="w-3 h-3 animate-spin" />;
    case ClaudeWorkingStatus.WaitingApproval:
      return <User className="w-3 h-3" />;
    case ClaudeWorkingStatus.WaitingInput:
      return <Clock className="w-3 h-3" />;
    case ClaudeWorkingStatus.Idle:
      return <Circle className="w-3 h-3" />;
    case ClaudeWorkingStatus.Unknown:
      return null;
  }
}

export function getClaudeStatusText(status: ClaudeWorkingStatus): string {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return "Claude is working";
    case ClaudeWorkingStatus.WaitingApproval:
      return "Waiting for approval";
    case ClaudeWorkingStatus.WaitingInput:
      return "Waiting for input";
    case ClaudeWorkingStatus.Idle:
      return "Idle";
    case ClaudeWorkingStatus.Unknown:
      return "Unknown";
  }
}

export function getClaudeStatusBorderColor(
  status: ClaudeWorkingStatus,
): string {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return "border-blue-500";
    case ClaudeWorkingStatus.WaitingApproval:
      return "border-purple-500";
    case ClaudeWorkingStatus.WaitingInput:
      return "border-yellow-500";
    case ClaudeWorkingStatus.Idle:
      return "border-gray-500";
    case ClaudeWorkingStatus.Unknown:
      return "border-muted";
  }
}

export function getClaudeStatusBgColor(status: ClaudeWorkingStatus): string {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return "bg-blue-500/10";
    case ClaudeWorkingStatus.WaitingApproval:
      return "bg-purple-500/10";
    case ClaudeWorkingStatus.WaitingInput:
      return "bg-yellow-500/10";
    case ClaudeWorkingStatus.Idle:
      return "bg-gray-500/10";
    case ClaudeWorkingStatus.Unknown:
      return "bg-muted/10";
  }
}
