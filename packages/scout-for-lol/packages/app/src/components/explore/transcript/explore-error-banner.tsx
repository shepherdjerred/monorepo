import { ChevronDown } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@scout-for-lol/design-system/components/collapsible";
export function ExploreErrorBanner(props: {
  readonly pageError: string;
  readonly conversationId: string | null;
  readonly runId?: string | null | undefined;
  readonly retryTargetId?: string | null | undefined;
  readonly executedSteps: number;
  readonly onRetry: () => void;
}) {
  return (
    <div className="rounded-md border border-scout-danger-fill/40 bg-scout-danger-fill/10 p-3 text-sm text-scout-ink space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{props.pageError}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={props.onRetry}
        >
          Retry
        </Button>
      </div>
      <Collapsible className="space-y-1.5 pt-0.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded py-0.5 px-1.5 text-xs text-scout-subtle hover:text-scout-ink hover:bg-scout-danger-fill/10 transition-colors group"
          >
            <span>Technical details</span>
            <ChevronDown
              className="size-3 text-scout-subtle transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="rounded border border-scout-border/60 bg-scout-surface p-2.5 text-xs font-mono space-y-1 overflow-x-auto select-text">
            <div>
              <span className="text-scout-subtle">Error: </span>
              <span className="text-scout-danger font-semibold">
                {props.pageError}
              </span>
            </div>
            {props.conversationId !== null && (
              <div>
                <span className="text-scout-subtle">Conversation ID: </span>
                <span>{props.conversationId}</span>
              </div>
            )}
            {props.runId !== undefined && props.runId !== null && (
              <div>
                <span className="text-scout-subtle">Run ID: </span>
                <span>{props.runId}</span>
              </div>
            )}
            {props.retryTargetId !== undefined &&
              props.retryTargetId !== null && (
                <div>
                  <span className="text-scout-subtle">Question ID: </span>
                  <span>{props.retryTargetId}</span>
                </div>
              )}
            {props.executedSteps > 0 && (
              <div>
                <span className="text-scout-subtle">Executed steps: </span>
                <span>{props.executedSteps.toString()}</span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
