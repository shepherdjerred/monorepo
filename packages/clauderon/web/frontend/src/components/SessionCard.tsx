import type { Session, SessionHealthReport } from "@clauderon/client";
import { SessionStatus } from "@clauderon/shared";
import type { MergeMethod } from "@clauderon/shared";
import { formatRelativeTime, cn, getRepoUrlFromPrUrl } from "@shepherdjerred/clauderon/web/frontend/src/lib/utils";
import { Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AGENT_CAPABILITIES } from "@/lib/agent-features";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { MergePrDialog } from "./MergePrDialog.tsx";
import { WorkflowProgress } from "./WorkflowProgress.tsx";
import { SessionCardFooterBar } from "./SessionCardFooter.tsx";
import { SessionStatusIndicators } from "./SessionStatusIndicators.tsx";
import { shouldSpanWide, getHealthDisplay } from "@/lib/session-card-helpers";
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

const STATUS_COLORS: Record<SessionStatus, string> = {
  [SessionStatus.Creating]: "bg-status-creating",
  [SessionStatus.Deleting]: "bg-status-creating",
  [SessionStatus.Running]: "bg-status-running",
  [SessionStatus.Idle]: "bg-status-idle",
  [SessionStatus.Completed]: "bg-status-completed",
  [SessionStatus.Failed]: "bg-status-failed",
  [SessionStatus.Archived]: "bg-status-archived",
};

function BranchLink({ session }: { session: Session }) {
  const repoUrl =
    session.pr_url != null && session.pr_url.length > 0
      ? getRepoUrlFromPrUrl(session.pr_url)
      : null;

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
      <Clock className="w-3 h-3" />
      <span>{formatRelativeTime(session.created_at)}</span>
      <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
      {repoUrl != null && repoUrl.length > 0 ? (
        <a
          href={`${repoUrl}/tree/${session.branch_name}`}
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
  );
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

  const statusColor = STATUS_COLORS[session.status];
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
                                {feature.supported ? "\u2713" : "\u26A0"}
                              </span>
                              <span
                                className={
                                  feature.supported ? "" : "text-yellow-600"
                                }
                              >
                                {feature.name}
                                {feature.note != null &&
                                  feature.note.length > 0 && (
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
              {healthReport != null &&
                healthReport.state.type !== "Healthy" && (
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
        {session.description != null && session.description.length > 0 && (
          <p className="text-base text-foreground/90 leading-relaxed mb-4">
            {session.description}
          </p>
        )}
        {(session.description == null || session.description.length === 0) && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-2">
            {session.initial_prompt}
          </p>
        )}

        {session.pr_url != null && session.pr_url.length > 0 && (
          <div className="mb-4 p-3 bg-accent/5 border-2 border-accent/20 rounded">
            <WorkflowProgress session={session} />
          </div>
        )}

        {session.repositories != null && session.repositories.length > 1 && (
          <details className="mb-3 border-2 border-primary/20 rounded">
            <summary className="cursor-pointer px-2 py-1 hover:bg-muted/50 text-xs font-mono font-semibold flex items-center gap-2">
              <span>{session.repositories.length} Repositories</span>
            </summary>
            <div className="px-3 py-2 space-y-1 bg-muted/20">
              {session.repositories.map((repo, idx) => (
                <div
                  key={idx}
                  className="text-xs font-mono flex items-center gap-2"
                >
                  {repo.is_primary && (
                    <span className="text-yellow-600 font-bold">*</span>
                  )}
                  <span className="font-semibold">{repo.mount_name}:</span>
                  <span className="text-muted-foreground truncate">
                    {repo.repo_path.split("/").pop()}/{repo.subdirectory || "."}
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    {repo.is_primary
                      ? "/workspace"
                      : `/repos/${repo.mount_name}`}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        <SessionStatusIndicators session={session} />

        <BranchLink session={session} />
      </CardContent>
      <SessionCardFooterBar
        session={session}
        onAttach={onAttach}
        onEdit={onEdit}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onRefresh={onRefresh}
        onDelete={onDelete}
        onOpenMergeDialog={() => {
          setMergePrDialogOpen(true);
        }}
      />

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
