import type { Session } from "@clauderon/client";
import { SessionStatus, CheckStatus, ClaudeWorkingStatus } from "@clauderon/shared";
import { formatRelativeTime, cn, getRepoUrlFromPrUrl } from "../lib/utils";
import { Archive, ArchiveRestore, Trash2, Terminal, CheckCircle2, XCircle, Clock, Loader2, User, Circle, AlertTriangle, Edit, RefreshCw } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProviderIcon } from "./ProviderIcon";

type SessionCardProps = {
  session: Session;
  onAttach: (session: Session) => void;
  onEdit: (session: Session) => void;
  onArchive: (session: Session) => void;
  onUnarchive: (session: Session) => void;
  onRefresh: (session: Session) => void;
  onDelete: (session: Session) => void;
}

function shouldSpanWide(session: Session): boolean {
  return (
    session.status === SessionStatus.Running ||
    (session.pr_url !== null && session.pr_url !== undefined && session.pr_check_status !== null && session.pr_check_status !== undefined) ||
    session.claude_status === ClaudeWorkingStatus.Working ||
    session.claude_status === ClaudeWorkingStatus.WaitingApproval ||
    session.claude_status === ClaudeWorkingStatus.WaitingInput ||
    session.merge_conflict ||
    session.worktree_dirty
  );
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
  const cardSizeClass = shouldSpanWide(session) ? "col-span-1 lg:col-span-2" : "col-span-1";

  return (
    <Card className={cn(
      "group border-2 transition-all duration-200",
      "hover:shadow-[6px_6px_0_hsl(var(--foreground))]",
      "hover:-translate-x-[2px] hover:-translate-y-[2px]",
      cardSizeClass
    )}>
      <CardHeader className="pb-3 px-6 pt-6">
        <div className="flex items-start gap-3">
          <div className={cn(
            "w-5 h-5 border-2 border-foreground shrink-0 mt-0.5 transition-all duration-300",
            "group-hover:scale-110",
            session.status === SessionStatus.Running && "animate-pulse",
            statusColor
          )} />

          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-xl leading-tight tracking-tight mb-1 truncate">
              {session.title || session.name}
            </h3>

            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="border-2 font-mono text-xs">
                {session.backend}
              </Badge>
              <Badge variant="outline" className="border-2 font-mono text-xs flex items-center gap-1">
                <ProviderIcon agent={session.agent} />
                {session.agent}
              </Badge>
              <Badge variant="secondary" className="font-mono text-xs">
                {session.access_mode}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {/* Description - primary content */}
        {session.description && (
          <p className="text-base text-foreground/90 leading-relaxed mb-4">
            {session.description}
          </p>
        )}
        {!session.description && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-2">
            {session.initial_prompt}
          </p>
        )}

        {/* Repositories Section */}
        {session.repositories && session.repositories.length > 1 && (
          <details className="mb-3 border-2 border-primary/20 rounded">
            <summary className="cursor-pointer px-2 py-1 hover:bg-muted/50 text-xs font-mono font-semibold flex items-center gap-2">
              <span>📁 {session.repositories.length} Repositories</span>
            </summary>
            <div className="px-3 py-2 space-y-1 bg-muted/20">
              {session.repositories.map((repo, idx) => (
                <div key={idx} className="text-xs font-mono flex items-center gap-2">
                  {repo.is_primary && (
                    <span className="text-yellow-600 font-bold">★</span>
                  )}
                  <span className="font-semibold">{repo.mount_name}:</span>
                  <span className="text-muted-foreground truncate">
                    {repo.repo_path.split('/').pop()}/{repo.subdirectory || '.'}
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    → {repo.is_primary ? '/workspace' : `/repos/${repo.mount_name}`}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Status section - grouped and styled */}
        <div className="space-y-2 mb-4">
          {/* PR/CI Status - prominent */}
          {session.pr_url && (
            <div className="flex items-center gap-2 p-2 bg-accent/5 border-l-4 border-accent">
              <a
                href={session.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-accent hover:text-accent/80 font-mono no-underline"
              >
                PR #{session.pr_url.split('/').pop()}
              </a>
              {session.pr_check_status && (
                <span className={cn(
                  "flex items-center gap-1.5 text-sm font-mono font-semibold",
                  getCheckStatusColor(session.pr_check_status)
                )}>
                  {getCheckStatusIcon(session.pr_check_status)}
                  <span>{session.pr_check_status}</span>
                </span>
              )}
            </div>
          )}

          {/* Claude Status - when active */}
          {session.claude_status !== ClaudeWorkingStatus.Unknown && (
            <div className={cn(
              "flex items-center gap-2 p-2 border-l-4 text-sm font-mono",
              getClaudeStatusBorderColor(session.claude_status),
              getClaudeStatusBgColor(session.claude_status)
            )}>
              {getClaudeStatusIcon(session.claude_status)}
              <span className="font-semibold">{getClaudeStatusText(session.claude_status)}</span>
              {session.claude_status_updated_at && (
                <span className="text-xs text-muted-foreground">
                  ({formatRelativeTime(session.claude_status_updated_at)})
                </span>
              )}
            </div>
          )}

          {/* Merge Conflict Warning */}
          {session.merge_conflict && (
            <div className="flex items-center gap-2 p-2 bg-red-500/10 border-l-4 border-red-500">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-mono font-bold text-red-500">
                Merge conflict with main
              </span>
            </div>
          )}

          {/* Working Tree Dirty Status */}
          {session.worktree_dirty && (
            <div className="flex items-center gap-2 p-2 bg-orange-500/10 border-l-4 border-orange-500">
              <Edit className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-sm font-mono font-semibold text-orange-500">
                Uncommitted changes
              </span>
            </div>
          )}
        </div>

        {/* Metadata - reduced emphasis with branch link */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
          <Clock className="w-3 h-3" />
          <span>{formatRelativeTime(session.created_at)}</span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
          {session.pr_url && getRepoUrlFromPrUrl(session.pr_url) ? (
            <a
              href={`${getRepoUrlFromPrUrl(session.pr_url)}/tree/${session.branch_name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80 transition-colors duration-200 truncate"
            >
              {session.branch_name}
            </a>
          ) : (
            <span className="truncate">{session.branch_name}</span>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 border-t-2 pt-4 px-6 pb-6 bg-card/50">
        <TooltipProvider>
          {session.status === SessionStatus.Running && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { onAttach(session); }}
                  aria-label="Attach to console"
                  className="cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
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
                className="cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
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
                  className="cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
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
                  className="cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
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
                  className="cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
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
                className="cursor-pointer text-destructive hover:bg-destructive/10 transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
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

function getClaudeStatusBorderColor(status: ClaudeWorkingStatus): string {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return "border-blue-500";
    case ClaudeWorkingStatus.WaitingApproval:
      return "border-purple-500";
    case ClaudeWorkingStatus.WaitingInput:
      return "border-yellow-500";
    case ClaudeWorkingStatus.Idle:
      return "border-gray-500";
    default:
      return "border-muted";
  }
}

function getClaudeStatusBgColor(status: ClaudeWorkingStatus): string {
  switch (status) {
    case ClaudeWorkingStatus.Working:
      return "bg-blue-500/10";
    case ClaudeWorkingStatus.WaitingApproval:
      return "bg-purple-500/10";
    case ClaudeWorkingStatus.WaitingInput:
      return "bg-yellow-500/10";
    case ClaudeWorkingStatus.Idle:
      return "bg-gray-500/10";
    default:
      return "bg-muted/10";
  }
}
