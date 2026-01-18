import type { Session } from "@clauderon/client";
import { SessionStatus, CheckStatus, ClaudeWorkingStatus } from "@clauderon/shared";
import { formatRelativeTime } from "../lib/utils";
import { Archive, ArchiveRestore, Trash2, Terminal, CheckCircle2, XCircle, Clock, Loader2, User, Circle, AlertTriangle, Edit, RefreshCw } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AGENT_CAPABILITIES, type AgentType } from "@/lib/agent-features";

type SessionCardProps = {
  session: Session;
  onAttach: (session: Session) => void;
  onEdit: (session: Session) => void;
  onArchive: (session: Session) => void;
  onUnarchive: (session: Session) => void;
  onRefresh: (session: Session) => void;
  onDelete: (session: Session) => void;
}

export function SessionCard({ session, onAttach, onEdit, onArchive, onUnarchive, onRefresh, onDelete }: SessionCardProps) {
  const statusColors: Record<SessionStatus, string> = {
    [SessionStatus.Creating]: "bg-status-creating",
    [SessionStatus.Deleting]: "bg-status-creating",
    [SessionStatus.Running]: "bg-status-running",
    [SessionStatus.Idle]: "bg-status-idle",
    [SessionStatus.Completed]: "bg-status-completed",
    [SessionStatus.Failed]: "bg-status-failed",
    [SessionStatus.Archived]: "bg-status-archived",
  };

  const statusColor = statusColors[session.status];

  return (
    <Card className="border-2 hover:shadow-[4px_4px_0_hsl(var(--foreground))] transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 border-2 border-foreground ${statusColor}`} />
          <h3 className="font-bold text-lg flex-1">{session.title || session.name}</h3>
          <Badge variant="outline" className="border-2 font-mono text-xs">
            {session.backend}
          </Badge>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="border-2 font-mono text-xs cursor-help">
                  {session.agent}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs max-w-xs">
                  <p className="font-semibold mb-1">{AGENT_CAPABILITIES[session.agent as AgentType]?.displayName || session.agent} Capabilities</p>
                  <ul className="space-y-1">
                    {AGENT_CAPABILITIES[session.agent as AgentType]?.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="flex-shrink-0">{feature.supported ? '✓' : '⚠'}</span>
                        <span className={feature.supported ? "" : "text-yellow-600"}>
                          {feature.name}
                          {feature.note && <span className="text-muted-foreground block text-xs mt-0.5">{feature.note}</span>}
                        </span>
                      </li>
                    )) || <li>No capability information available</li>}
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent>
        {session.description && (
          <p className="text-sm text-muted-foreground mb-2">
            {session.description}
          </p>
        )}
        {!session.description && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {session.initial_prompt}
          </p>
        )}

        {/* Status Indicators */}
        <div className="flex flex-col gap-1 mb-3">
          {/* PR and CI Status */}
          {session.pr_url && (
            <div className="flex items-center gap-2 text-xs">
              <a
                href={session.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer text-blue-500 hover:underline font-mono transition-colors duration-200"
              >
                PR #{session.pr_url.split('/').pop()}
              </a>
              {session.pr_check_status && (
                <span className={`flex items-center gap-1 ${getCheckStatusColor(session.pr_check_status)}`}>
                  {getCheckStatusIcon(session.pr_check_status)}
                  <span className="font-mono">{session.pr_check_status}</span>
                </span>
              )}
            </div>
          )}

          {/* Claude Working Status */}
          {session.claude_status !== ClaudeWorkingStatus.Unknown && (
            <div className={`flex items-center gap-1 text-xs ${getClaudeStatusColor(session.claude_status)}`}>
              {getClaudeStatusIcon(session.claude_status)}
              <span className="font-mono">{getClaudeStatusText(session.claude_status)}</span>
              {session.claude_status_updated_at && (
                <span className="text-muted-foreground font-mono">
                  ({formatRelativeTime(session.claude_status_updated_at)})
                </span>
              )}
            </div>
          )}

          {/* Merge Conflict Warning */}
          {session.merge_conflict && (
            <div className="flex items-center gap-1 text-xs text-red-500">
              <AlertTriangle className="w-3 h-3" />
              <span className="font-mono font-semibold">Merge conflict with main</span>
            </div>
          )}

          {/* Working Tree Dirty Status */}
          {session.worktree_dirty && (
            <div className="flex items-center gap-1 text-xs text-orange-500">
              <Edit className="w-3 h-3" />
              <span className="font-mono font-semibold">Uncommitted changes</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="font-mono text-muted-foreground">
            {formatRelativeTime(session.created_at)}
          </span>
          <span className="text-muted-foreground">{session.branch_name}</span>
          <Badge variant="secondary" className="font-mono">
            {session.access_mode}
          </Badge>
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 border-t-2 pt-4">
        <TooltipProvider>
          {session.status === SessionStatus.Running && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { onAttach(session); }}
                  aria-label="Attach to console"
                  className="cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md"
                >
                  <Terminal className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach to console</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { onEdit(session); }}
                aria-label="Edit session"
                className="cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md"
              >
                <Edit className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit title/description</TooltipContent>
          </Tooltip>

          {session.backend === "Docker" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { onRefresh(session); }}
                  aria-label="Refresh session"
                  className="cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh (pull latest image and recreate)</TooltipContent>
            </Tooltip>
          )}

          {session.status === SessionStatus.Archived ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { onUnarchive(session); }}
                  aria-label="Unarchive session"
                  className="cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md"
                >
                  <ArchiveRestore className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Restore from archive</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { onArchive(session); }}
                  aria-label="Archive session"
                  className="cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md"
                >
                  <Archive className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive session</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { onDelete(session); }}
                aria-label="Delete session"
                className="cursor-pointer text-destructive hover:bg-destructive/10 transition-all duration-200 hover:scale-110 hover:shadow-md"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete session</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardFooter>
    </Card>
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
    default:
      return "text-gray-500";
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
    default:
      return <Circle className="w-3 h-3" />;
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
