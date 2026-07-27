import { useState } from "react";
import {
  isQueueCurrentlyAvailable,
  QueueTypeSchema,
  queueAvailabilityNote,
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

/**
 * Short human summary of a filter spec for triggers/table cells. Tolerates
 * `undefined` (a backend deployed before the `filters` field omits it — see
 * `subscriptionFilterQueues`): a missing spec renders as "All queues" instead
 * of crashing the subscriptions table.
 */
export function summarizeFilters(
  spec: SubscriptionFilterSpec | null | undefined,
): string {
  const queues = subscriptionFilterQueues(spec);
  if (queues.length === 0) {
    return "All queues";
  }
  return describeSubscriptionFilters(spec);
}

function QueueRow(props: {
  queue: QueueType;
  isSelected: boolean;
  onToggle: (queue: QueueType) => void;
}) {
  const note = queueAvailabilityNote(props.queue);
  return (
    <button
      type="button"
      aria-pressed={props.isSelected}
      className={cn(
        "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
        note !== undefined && "text-muted-foreground",
      )}
      onClick={() => {
        props.onToggle(props.queue);
      }}
    >
      <span className="flex flex-col items-start">
        <span>{queueTypeToDisplayString(props.queue)}</span>
        {note !== undefined && <span className="text-xs">{note}</span>}
      </span>
      {props.isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
    </button>
  );
}

/**
 * Queue multi-select. Empty selection means "notify all" (no filter), matching
 * the backend's null-spec semantics. Value/onChange work in terms of the full
 * SubscriptionFilterSpec so the extensible model stays intact.
 *
 * Limited-time queues that are not currently live are hidden behind a
 * "show unavailable" toggle; already-selected ones always stay visible so
 * they can be deselected.
 */
export function SubscriptionFilterFields(props: {
  id?: string;
  value: SubscriptionFilterSpec | null;
  onChange: (next: SubscriptionFilterSpec | null) => void;
}) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const selected = subscriptionFilterQueues(props.value);
  const selectedSet = new Set<QueueType>(selected);

  const visibleQueues = QueueTypeSchema.options.filter(
    (queue) => isQueueCurrentlyAvailable(queue) || selectedSet.has(queue),
  );
  const hiddenQueues = QueueTypeSchema.options.filter(
    (queue) => !isQueueCurrentlyAvailable(queue) && !selectedSet.has(queue),
  );

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
        {visibleQueues.map((queue) => (
          <QueueRow
            key={queue}
            queue={queue}
            isSelected={selectedSet.has(queue)}
            onToggle={toggle}
          />
        ))}
        {hiddenQueues.length > 0 && (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              className="w-full rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                setShowUnavailable((current) => !current);
              }}
            >
              {showUnavailable
                ? "Hide unavailable queues"
                : `Show ${hiddenQueues.length.toString()} unavailable queues`}
            </button>
            {showUnavailable &&
              hiddenQueues.map((queue) => (
                <QueueRow
                  key={queue}
                  queue={queue}
                  isSelected={false}
                  onToggle={toggle}
                />
              ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
