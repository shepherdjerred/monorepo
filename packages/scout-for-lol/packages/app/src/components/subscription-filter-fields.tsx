import { useState } from "react";
import {
  DOOM_BOTS_QUEUES,
  isQueueCurrentlyAvailable,
  QueueTypeSchema,
  queueAvailabilityNote,
  queueTypeToDisplayString,
  subscriptionFilterQueues,
  describeSubscriptionFilters,
  type QueueType,
  type SubscriptionFilterSpec,
} from "@scout-for-lol/data";
import { Check, ChevronDown, Minus } from "lucide-react";
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

/**
 * One selectable row. The Doom Bots difficulties present as a single entry
 * that toggles all three queue types together.
 */
type PickerEntry = { key: string; label: string; queues: QueueType[] };

const PICKER_ENTRIES: PickerEntry[] = QueueTypeSchema.options.reduce<
  PickerEntry[]
>((entries, queue) => {
  if (DOOM_BOTS_QUEUES.includes(queue)) {
    if (!entries.some((entry) => entry.key === "doom-bots")) {
      entries.push({
        key: "doom-bots",
        label: "Doom Bots",
        queues: [...DOOM_BOTS_QUEUES],
      });
    }
    return entries;
  }
  entries.push({
    key: queue,
    label: queueTypeToDisplayString(queue),
    queues: [queue],
  });
  return entries;
}, []);

function entryAvailable(entry: PickerEntry): boolean {
  return entry.queues.some((queue) => isQueueCurrentlyAvailable(queue));
}

function entryNote(entry: PickerEntry): string | undefined {
  const first = entry.queues[0];
  return first === undefined ? undefined : queueAvailabilityNote(first);
}

function EntryRow(props: {
  entry: PickerEntry;
  isSelected: boolean;
  // A multi-queue entry (Doom Bots) whose queues are only partially selected —
  // e.g. a legacy filter created when the difficulties were independent picks.
  isPartial: boolean;
  onToggle: (entry: PickerEntry) => void;
}) {
  const note = entryNote(props.entry);
  return (
    <button
      type="button"
      aria-pressed={props.isPartial ? "mixed" : props.isSelected}
      className={cn(
        "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
        note !== undefined && "text-muted-foreground",
      )}
      onClick={() => {
        props.onToggle(props.entry);
      }}
    >
      <span className="flex flex-col items-start">
        <span>{props.entry.label}</span>
        {note !== undefined && <span className="text-xs">{note}</span>}
      </span>
      {props.isSelected ? (
        <Check className="h-4 w-4 shrink-0" />
      ) : props.isPartial ? (
        <Minus className="h-4 w-4 shrink-0" />
      ) : null}
    </button>
  );
}

/**
 * Queue multi-select. Empty selection means "notify all" (no filter), matching
 * the backend's null-spec semantics. Value/onChange work in terms of the full
 * SubscriptionFilterSpec so the extensible model stays intact.
 *
 * Limited-time queues that are not currently live are hidden until the
 * "Show unavailable queues" checkbox reveals them; already-selected ones
 * always stay visible so they can be deselected.
 */
export function SubscriptionFilterFields(props: {
  id?: string;
  value: SubscriptionFilterSpec | null;
  onChange: (next: SubscriptionFilterSpec | null) => void;
}) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const selected = subscriptionFilterQueues(props.value);
  const selectedSet = new Set<QueueType>(selected);

  // "Has any selection" drives visibility (so a partially-selected group stays
  // reachable); "fully selected" drives the checkmark and toggle direction. A
  // multi-queue entry (Doom Bots) can be partial when a legacy filter selected
  // only some difficulties back when they were independent picks.
  const entryHasSelection = (entry: PickerEntry) =>
    entry.queues.some((queue) => selectedSet.has(queue));
  const entryFullySelected = (entry: PickerEntry) =>
    entry.queues.every((queue) => selectedSet.has(queue));

  const unavailableCount = PICKER_ENTRIES.filter(
    (entry) => !entryAvailable(entry) && !entryHasSelection(entry),
  ).length;
  // Selected-but-unavailable entries always stay visible (deselect path).
  const visibleEntries = PICKER_ENTRIES.filter(
    (entry) =>
      showUnavailable || entryAvailable(entry) || entryHasSelection(entry),
  );

  const toggle = (entry: PickerEntry) => {
    // Fully selected → clear the whole group. Partial or none → complete it by
    // adding the missing queues (so clicking a legacy partial Doom Bots filter
    // fills the group in rather than clearing the difficulties already chosen).
    const next = entryFullySelected(entry)
      ? selected.filter((queue) => !entry.queues.includes(queue))
      : [
          ...selected,
          ...entry.queues.filter((queue) => !selectedSet.has(queue)),
        ];
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
        {unavailableCount > 0 && (
          <>
            <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground">
              <input
                type="checkbox"
                checked={showUnavailable}
                onChange={(event) => {
                  setShowUnavailable(event.target.checked);
                }}
              />
              Show unavailable queues ({unavailableCount})
            </label>
            <div className="my-1 h-px bg-border" />
          </>
        )}
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
        {visibleEntries.map((entry) => (
          <EntryRow
            key={entry.key}
            entry={entry}
            isSelected={entryFullySelected(entry)}
            isPartial={entryHasSelection(entry) && !entryFullySelected(entry)}
            onToggle={toggle}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}
