import type { Session } from "@clauderon/client";
import { CheckStatus, ReviewDecision, WorkflowStage } from "@clauderon/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getWorkflowStage, getStageColor } from "@/lib/session-card-helpers";

const STAGES = [
  { name: "Plan", value: WorkflowStage.Planning },
  { name: "Impl", value: WorkflowStage.Implementation },
  { name: "Review", value: WorkflowStage.Review },
  { name: "Ready", value: WorkflowStage.ReadyToMerge },
  { name: "Merged", value: WorkflowStage.Merged },
];

export function WorkflowProgress({ session }: { session: Session }) {
  const stage = getWorkflowStage(session);

  const ciBlocked = session.pr_check_status === CheckStatus.Failing;
  const conflictBlocked = session.merge_conflict;
  const changesRequested =
    session.pr_review_decision === ReviewDecision.ChangesRequested;
  const hasBlockers = ciBlocked || conflictBlocked || changesRequested;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {STAGES.map((s, idx) => (
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
            {idx < STAGES.length - 1 && (
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
            {ciBlocked && <li>CI checks failing</li>}
            {conflictBlocked && <li>Merge conflicts with main</li>}
            {changesRequested && <li>Changes requested on PR</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
