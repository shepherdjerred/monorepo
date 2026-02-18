import type { Session } from "@clauderon/client";
import { ClaudeWorkingStatus } from "@clauderon/shared";
import { formatRelativeTime, cn } from "@/lib/utils";
import { AlertTriangle, Edit } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getStatusLabel,
  getCheckStatusColor,
  getCheckStatusIcon,
  getClaudeStatusIcon,
  getClaudeStatusText,
  getClaudeStatusBorderColor,
  getClaudeStatusBgColor,
} from "@/lib/session-card-helpers";

function ChangedFilesTooltip({
  files,
}: {
  files: { status: string; path: string }[];
}) {
  const grouped = files.reduce<Record<string, string[]>>((acc, file) => {
    const statusKey = getStatusLabel(file.status);
    acc[statusKey] ??= [];
    acc[statusKey].push(file.path);
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([status, paths]) => (
        <div key={status}>
          <div className="font-semibold text-xs mb-1">{status}:</div>
          <div className="font-mono text-xs pl-2 space-y-0.5">
            {paths.slice(0, 5).map((file) => (
              <div key={file} className="truncate max-w-xs">
                {file}
              </div>
            ))}
            {paths.length > 5 && (
              <div className="text-muted-foreground italic">
                ...and {paths.length - 5} more
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SessionStatusIndicators({ session }: { session: Session }) {
  return (
    <div className="space-y-2 mb-4">
      {session.pr_url != null && session.pr_url.length > 0 && (
        <div className="flex items-center gap-2 p-2 bg-accent/5 border-l-4 border-accent">
          <a
            href={session.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-accent hover:text-accent/80 font-mono no-underline"
          >
            PR #{session.pr_url.split("/").pop()}
          </a>
          {session.pr_check_status != null &&
            session.pr_check_status.length > 0 && (
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

      {session.merge_conflict && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border-l-4 border-red-500">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <span className="text-sm font-mono font-bold text-red-500">
            Merge conflict with main
          </span>
        </div>
      )}

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
              {session.worktree_changed_files != null &&
              session.worktree_changed_files.length > 0 ? (
                <ChangedFilesTooltip files={session.worktree_changed_files} />
              ) : (
                <div>Files have uncommitted changes</div>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {session.dangerous_copy_creds === true && (
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
                <p className="font-semibold mb-1">Limited Status Tracking</p>
                <p>
                  This session uses --dangerous-copy-creds, which bypasses the
                  proxy. Agent status updates (working, idle, etc.) are not
                  available.
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
