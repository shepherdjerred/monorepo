import {
  QueueTypeSchema,
  queueTypeToDisplayString,
  subscriptionFilterQueues,
  describeSubscriptionFilters,
  type QueueType,
  type SubscriptionFilterSpec,
} from "@scout-for-lol/data";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "#src/components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#src/components/ui/popover.tsx";
import { cn } from "#src/lib/cn.ts";

/** Build a filter spec from a set of queues (empty selection = null). */
function queuesToSpec(queues: QueueType[]): SubscriptionFilterSpec | null {
  if (queues.length === 0) {
    return null;
  }
  return { version: 1, filters: [{ type: "queue", queues }] };
}

/** Short human summary of a filter spec for triggers/table cells. */
export function summarizeFilters(spec: SubscriptionFilterSpec | null): string {
  const queues = subscriptionFilterQueues(spec);
  if (queues.length === 0) {
    return "All queues";
  }
  return describeSubscriptionFilters(spec);
}

/**
 * Queue multi-select. Empty selection means "notify all" (no filter), matching
 * the backend's null-spec semantics. Value/onChange work in terms of the full
 * SubscriptionFilterSpec so the extensible model stays intact.
 */
export function SubscriptionFilterFields(props: {
  id?: string;
  value: SubscriptionFilterSpec | null;
  onChange: (next: SubscriptionFilterSpec | null) => void;
}) {
  const selected = subscriptionFilterQueues(props.value);
  const selectedSet = new Set<QueueType>(selected);

  const toggle = (queue: QueueType) => {
    const next = selectedSet.has(queue)
      ? selected.filter((q) => q !== queue)
      : [...selected, queue];
    props.onChange(queuesToSpec(next));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={props.id}
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{summarizeFilters(props.value)}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-72 w-64 overflow-y-auto p-1"
        align="start"
      >
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
            selected.length === 0 && "font-medium",
          )}
          onClick={() => {
            props.onChange(null);
          }}
        >
          <span>All queues</span>
          {selected.length === 0 ? <Check className="h-4 w-4" /> : null}
        </button>
        <div className="my-1 h-px bg-border" />
        {QueueTypeSchema.options.map((queue) => {
          const isSelected = selectedSet.has(queue);
          return (
            <button
              key={queue}
              type="button"
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                toggle(queue);
              }}
            >
              <span>{queueTypeToDisplayString(queue)}</span>
              {isSelected ? <Check className="h-4 w-4" /> : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
