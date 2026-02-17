import type {
  Session,
  SessionHealthReport,
  ResourceState,
} from "@clauderon/client";
import {
  SessionStatus,
  CheckStatus,
  ClaudeWorkingStatus,
  WorkflowStage,
  ReviewDecision,
} from "@clauderon/shared";
import type { MergeMethod } from "@clauderon/shared";
import { formatRelativeTime, cn, getRepoUrlFromPrUrl } from "../lib/utils";
import {
  Archive,
  ArchiveRestore,
  Trash2,
  Terminal,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  User,
  Circle,
  AlertTriangle,
  Edit,
  RefreshCw,
  GitMerge,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AGENT_CAPABILITIES } from "@/lib/agent-features";
import { ProviderIcon } from "./ProviderIcon";
import { MergePrDialog } from "./MergePrDialog";
import { useState } from "react";

type SessionCardProps = {
  session: Session;
  healthReport?: SessionHealthReport;
  onAttach: (session: Session) => void;
  onEdit: (session: Session) => void;
  onArchive: (session: Session) => void;
  onUnarchive: (session: Session) => void;
  onRefresh: (session: Session) => void;
  onDelete: (session: Session) => void;
  onMergePr: (
    session: Session,
    method: MergeMethod,
    deleteBranch: boolean,
  ) => void;
};

// Helper function to map git status codes to readable labels
function getStatusLabel(status: string): string {
  // Git status --porcelain format uses 2-char codes
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

function shouldSpanWide(session: Session): boolean {
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
  const changesRequested =
    session.pr_review_decision === ReviewDecision.ChangesRequested;

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
  if (
    session.pr_review_decision === ReviewDecision.ReviewRequired ||
    !session.pr_review_decision
  ) {
    return WorkflowStage.Review;
  }

  return WorkflowStage.Implementation;
}

function getStageColor(stage: WorkflowStage): string {
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

// WorkflowProgress component showing the full progress stepper
function WorkflowProgress({ session }: { session: Session }) {
  const stage = getWorkflowStage(session);
  const stages = [
    { name: "Plan", value: WorkflowStage.Planning },
    { name: "Impl", value: WorkflowStage.Implementation },
    { name: "Review", value: WorkflowStage.Review },
    { name: "Ready", value: WorkflowStage.ReadyToMerge },
    { name: "Merged", value: WorkflowStage.Merged },
  ];

  // Check for blockers
  const ciBlocked = session.pr_check_status === CheckStatus.Failing;
  const conflictBlocked = session.merge_conflict;
  const changesRequested =
    session.pr_review_decision === ReviewDecision.ChangesRequested;
  const hasBlockers = ciBlocked || conflictBlocked || changesRequested;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {stages.map((s, idx) => (
          <div key={s.value} className="flex items-center flex-1">
            <Badge
              variant={stage === s.value ? "default" : "outline"}
              className={cn(
                "text-xs flex-shrink-0",
                stage === s.value && getStageColor(s.value),
              )}
            >
              {idx + 1}. {s.name}
            </Badge>
            {idx < stages.length - 1 && (
              <div className="flex-1 mx-2 h-0.5 bg-muted-foreground/30" />
            )}
          </div>
        ))}
      </div>

      {stage === WorkflowStage.Blocked && hasBlockers && (
        <div className="mt-2 p-2 bg-red-500/10 border-l-4 border-red-500">
          <div className="text-sm font-semibold text-red-500 mb-1">
            Blockers:
          </div>
          <ul className="text-xs space-y-1 ml-4 text-red-600">
            {ciBlocked && <li>• CI checks failing</li>}
            {conflictBlocked && <li>• Merge conflicts with main</li>}
            {changesRequested && <li>• Changes requested on PR</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// Helper function to get health display info from ResourceState
function getHealthDisplay(state: ResourceState): {
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

export function SessionCard({
  session,
  healthReport,
  onAttach,
  onEdit,
  onArchive,
  onUnarchive,
  onRefresh,
  onDelete,
  onMergePr,
}: SessionCardProps) {
  const [mergePrDialogOpen, setMergePrDialogOpen] = useState(false);

  const handleMergePr = (method: MergeMethod, deleteBranch: boolean) => {
    onMergePr(session, method, deleteBranch);
    setMergePrDialogOpen(false);
  };

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
  const cardSizeClass = shouldSpanWide(session)
    ? "col-span-1 lg:col-span-2"
    : "col-span-1";

  return (
    <Card
      className={cn(
        "group border-2 transition-all duration-200",
        "hover:shadow-[6px_6px_0_hsl(var(--foreground))]",
        "hover:-translate-x-[2px] hover:-translate-y-[2px]",
        cardSizeClass,
      )}
    >
      <CardHeader className="pb-3 px-6 pt-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "w-5 h-5 border-2 border-foreground shrink-0 mt-0.5 transition-all duration-300",
              "group-hover:scale-110",
              session.status === SessionStatus.Running && "animate-pulse",
              statusColor,
            )}
          />

          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-xl leading-tight tracking-tight mb-1 truncate">
              {session.title ?? session.name}
            </h3>

            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="border-2 font-mono text-xs">
                {session.backend}
              </Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="border-2 font-mono text-xs cursor-help flex items-center gap-1"
                    >
                      <ProviderIcon agent={session.agent} />
                      {session.agent}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs max-w-xs">
                      <p className="font-semibold mb-1">
                        {AGENT_CAPABILITIES[session.agent].displayName}{" "}
                        Capabilities
                      </p>
                      <ul className="space-y-1">
                        {AGENT_CAPABILITIES[session.agent].features.map(
                          (feature, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className="flex-shrink-0">
                                {feature.supported ? "✓" : "⚠"}
                              </span>
                              <span
                                className={
                                  feature.supported ? "" : "text-yellow-600"
                                }
                              >
                                {feature.name}
                                {feature.note && (
                                  <span className="text-muted-foreground block text-xs mt-0.5">
                                    {feature.note}
                                  </span>
                                )}
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Badge variant="secondary" className="font-mono text-xs">
                {session.access_mode}
              </Badge>
              {healthReport && healthReport.state.type !== "Healthy" && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border font-mono text-xs cursor-help",
                          getHealthDisplay(healthReport.state).className,
                        )}
                      >
                        {getHealthDisplay(healthReport.state).label}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="max-w-xs text-xs">
                        <p className="font-semibold mb-1">Health Status</p>
                        <p>{getHealthDisplay(healthReport.state).tooltip}</p>
                        {healthReport.description && (
                          <p className="mt-1 text-muted-foreground">
                            {healthReport.description}
                          </p>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
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

        {/* Workflow Progress - shows PR workflow stage progression */}
        {session.pr_url && (
          <div className="mb-4 p-3 bg-accent/5 border-2 border-accent/20 rounded">
            <WorkflowProgress session={session} />
          </div>
        )}

        {/* Repositories Section */}
        {session.repositories && session.repositories.length > 1 && (
          <details className="mb-3 border-2 border-primary/20 rounded">
            <summary className="cursor-pointer px-2 py-1 hover:bg-muted/50 text-xs font-mono font-semibold flex items-center gap-2">
              <span>📁 {session.repositories.length} Repositories</span>
            </summary>
            <div className="px-3 py-2 space-y-1 bg-muted/20">
              {session.repositories.map((repo, idx) => (
                <div
                  key={idx}
                  className="text-xs font-mono flex items-center gap-2"
                >
                  {repo.is_primary && (
                    <span className="text-yellow-600 font-bold">★</span>
                  )}
                  <span className="font-semibold">{repo.mount_name}:</span>
                  <span className="text-muted-foreground truncate">
                    {repo.repo_path.split("/").pop()}/{repo.subdirectory || "."}
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    →{" "}
                    {repo.is_primary
                      ? "/workspace"
                      : `/repos/${repo.mount_name}`}
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
                PR #{session.pr_url.split("/").pop()}
              </a>
              {session.pr_check_status && (
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-mono font-semibold",
                    getCheckStatusColor(session.pr_check_status),
                  )}
                >
                  {getCheckStatusIcon(session.pr_check_status)}
                  <span>{session.pr_check_status}</span>
                </span>
              )}
            </div>
          )}

          {/* Claude Status - when active */}
          {session.claude_status !== ClaudeWorkingStatus.Unknown && (
            <div
              className={cn(
                "flex items-center gap-2 p-2 border-l-4 text-sm font-mono",
                getClaudeStatusBorderColor(session.claude_status),
                getClaudeStatusBgColor(session.claude_status),
              )}
            >
              {getClaudeStatusIcon(session.claude_status)}
              <span className="font-semibold">
                {getClaudeStatusText(session.claude_status)}
              </span>
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 p-2 bg-orange-500/10 border-l-4 border-orange-500 cursor-help">
                    <Edit className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-sm font-mono font-semibold text-orange-500">
                      Uncommitted changes
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-md">
                  {session.worktree_changed_files &&
                  session.worktree_changed_files.length > 0 ? (
                    <div className="space-y-2">
                      {(() => {
                        // Group files by status
                        const grouped = session.worktree_changed_files.reduce<
                          Record<string, string[]>
                        >((acc, file) => {
                          const statusKey = getStatusLabel(file.status);
                          acc[statusKey] ??= [];
                          acc[statusKey].push(file.path);
                          return acc;
                        }, {});

                        return Object.entries(grouped).map(
                          ([status, files]) => (
                            <div key={status}>
                              <div className="font-semibold text-xs mb-1">
                                {status}:
                              </div>
                              <div className="font-mono text-xs pl-2 space-y-0.5">
                                {files.slice(0, 5).map((file) => (
                                  <div key={file} className="truncate max-w-xs">
                                    {file}
                                  </div>
                                ))}
                                {files.length > 5 && (
                                  <div className="text-muted-foreground italic">
                                    ...and {files.length - 5} more
                                  </div>
                                )}
                              </div>
                            </div>
                          ),
                        );
                      })()}
                    </div>
                  ) : (
                    <div>Files have uncommitted changes</div>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Copy-creds mode notice */}
          {session.dangerous_copy_creds && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border-l-4 border-yellow-500 cursor-help">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-600" />
                    <span className="text-sm font-mono font-semibold text-yellow-600">
                      Copy-creds mode
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="max-w-xs text-xs">
                    <p className="font-semibold mb-1">
                      Limited Status Tracking
                    </p>
                    <p>
                      This session uses --dangerous-copy-creds, which bypasses
                      the proxy. Agent status updates (working, idle, etc.) are
                      not available.
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Metadata - reduced emphasis with branch link */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
          <Clock className="w-3 h-3" />
          <span>{formatRelativeTime(session.created_at)}</span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
          {session.pr_url && getRepoUrlFromPrUrl(session.pr_url) ? (
            <a
              href={`${String(getRepoUrlFromPrUrl(session.pr_url))}/tree/${session.branch_name}`}
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
                  onClick={() => {
                    onAttach(session);
                  }}
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
                onClick={() => {
                  onEdit(session);
                }}
                aria-label="Edit session"
                className="cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
              >
                <Edit className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit title/description</TooltipContent>
          </Tooltip>

          {(session.backend as string) === "Docker" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    onRefresh(session);
                  }}
                  aria-label="Refresh session"
                  className="cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Refresh (pull latest image and recreate)
              </TooltipContent>
            </Tooltip>
          )}

          {session.can_merge_pr && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setMergePrDialogOpen(true);
                  }}
                  aria-label="Merge pull request"
                  className="cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md"
                >
                  <GitMerge className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Merge pull request</TooltipContent>
            </Tooltip>
          )}

          {session.status === SessionStatus.Archived ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    onUnarchive(session);
                  }}
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
                  onClick={() => {
                    onArchive(session);
                  }}
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
                onClick={() => {
                  onDelete(session);
                }}
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

      <MergePrDialog
        isOpen={mergePrDialogOpen}
        onClose={() => {
          setMergePrDialogOpen(false);
        }}
        onConfirm={handleMergePr}
        session={session}
      />
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
