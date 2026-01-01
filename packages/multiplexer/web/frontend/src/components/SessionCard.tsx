import type { Session } from "@mux/client";
import { SessionStatus, CheckStatus, ClaudeWorkingStatus } from "@mux/shared";
import { formatRelativeTime } from "../lib/utils";
import { Circle, Archive, Trash2, Terminal, CheckCircle2, XCircle, Clock, Loader2, User } from "lucide-react";

type SessionCardProps = {
  session: Session;
  onAttach: (session: Session) => void;
  onArchive: (session: Session) => void;
  onDelete: (session: Session) => void;
}

export function SessionCard({ session, onAttach, onArchive, onDelete }: SessionCardProps) {
  const statusColors: Record<SessionStatus, string> = {
    [SessionStatus.Creating]: "text-blue-500",
    [SessionStatus.Running]: "text-green-500",
    [SessionStatus.Idle]: "text-yellow-500",
    [SessionStatus.Completed]: "text-gray-500",
    [SessionStatus.Failed]: "text-red-500",
    [SessionStatus.Archived]: "text-gray-400",
  };

  const statusColor = statusColors[session.status];

  return (
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow bg-card">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Circle className={`w-3 h-3 fill-current ${statusColor}`} />
            <h3 className="font-semibold text-lg">{session.name}</h3>
            <span className="text-xs text-muted-foreground">
              {session.backend}
            </span>
          </div>

          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
            {session.initial_prompt}
          </p>

          {/* Status Indicators */}
          <div className="flex flex-col gap-1 mb-2">
            {/* PR and CI Status */}
            {session.pr_url && (
              <div className="flex items-center gap-2 text-xs">
                <a
                  href={session.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  PR #{session.pr_url.split('/').pop()}
                </a>
                {session.pr_check_status && (
                  <span className={`flex items-center gap-1 ${getCheckStatusColor(session.pr_check_status)}`}>
                    {getCheckStatusIcon(session.pr_check_status)}
                    {session.pr_check_status}
                  </span>
                )}
              </div>
            )}

            {/* Claude Working Status */}
            {session.claude_status !== ClaudeWorkingStatus.Unknown && (
              <div className={`flex items-center gap-1 text-xs ${getClaudeStatusColor(session.claude_status)}`}>
                {getClaudeStatusIcon(session.claude_status)}
                <span>{getClaudeStatusText(session.claude_status)}</span>
                {session.claude_status_updated_at && (
                  <span className="text-muted-foreground">
                    ({formatRelativeTime(session.claude_status_updated_at)})
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{formatRelativeTime(session.created_at)}</span>
            <span>{session.branch_name}</span>
            <span className="px-2 py-0.5 rounded bg-secondary">
              {session.access_mode}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 ml-4">
          {session.status === SessionStatus.Running && (
            <button
              onClick={() => { onAttach(session); }}
              className="p-2 hover:bg-secondary rounded-md transition-colors"
              title="Attach to console"
            >
              <Terminal className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => { onArchive(session); }}
            className="p-2 hover:bg-secondary rounded-md transition-colors"
            title="Archive session"
          >
            <Archive className="w-4 h-4" />
          </button>

          <button
            onClick={() => { onDelete(session); }}
            className="p-2 hover:bg-destructive/10 text-destructive rounded-md transition-colors"
            title="Delete session"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function getCheckStatusColor(status: CheckStatus): string {
  switch (status) {
    case CheckStatus.Passing:
    case CheckStatus.Mergeable:
    case CheckStatus.Merged:
      return "text-green-500";
    case CheckStatus.Failing:
      return "text-red-500";
    case CheckStatus.Pending:
      return "text-yellow-500";
  }
}

function getCheckStatusIcon(status: CheckStatus) {
  switch (status) {
    case CheckStatus.Passing:
    case CheckStatus.Mergeable:
    case CheckStatus.Merged:
      return <CheckCircle2 className="w-3 h-3" />;
    case CheckStatus.Failing:
      return <XCircle className="w-3 h-3" />;
    case CheckStatus.Pending:
      return <Clock className="w-3 h-3" />;
  }
}

function getClaudeStatusColor(status: ClaudeWorkingStatus): string {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return "text-blue-500";
    case ClaudeWorkingStatus.WaitingApproval:
      return "text-purple-500";
    case ClaudeWorkingStatus.WaitingInput:
      return "text-yellow-500";
    case ClaudeWorkingStatus.Idle:
      return "text-gray-500";
    default:
      return "text-muted-foreground";
  }
}

function getClaudeStatusIcon(status: ClaudeWorkingStatus) {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return <Loader2 className="w-3 h-3 animate-spin" />;
    case ClaudeWorkingStatus.WaitingApproval:
      return <User className="w-3 h-3" />;
    case ClaudeWorkingStatus.WaitingInput:
      return <Clock className="w-3 h-3" />;
    case ClaudeWorkingStatus.Idle:
      return <Circle className="w-3 h-3" />;
    default:
      return null;
  }
}

function getClaudeStatusText(status: ClaudeWorkingStatus): string {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return "Claude is working";
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
