import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";

/** An overflow this small is shown outright; a toggle would hide less than it costs. */
const CAP_SLACK = 2;

/** How many of `length` items a list capped at `cap` shows while collapsed. */
export function cappedCount(length: number, cap: number): number {
  return length > cap + CAP_SLACK ? cap : length;
}

export type Capped<T> = {
  readonly shown: readonly T[];
  /** Items the cap is holding back while collapsed. */
  readonly hidden: number;
  /** Whether the list is long enough to need the toggle at all. */
  readonly capped: boolean;
  readonly expanded: boolean;
  readonly toggle: () => void;
};

/**
 * The first `cap` items of a list until it is expanded. Every long list in
 * the ops pages goes through this, so they all cap and expand the same way.
 */
export function useCapped<T>(items: readonly T[], cap: number): Capped<T> {
  const [expanded, setExpanded] = useState(false);
  const visible = cappedCount(items.length, cap);
  const capped = visible < items.length;
  return {
    shown: capped && !expanded ? items.slice(0, visible) : items,
    hidden: items.length - visible,
    capped,
    expanded,
    toggle: () => {
      setExpanded((value) => !value);
    },
  };
}

/** The "Show N more" button under a capped list; nothing when it fits. */
export function ListToggle({
  list,
  controls,
}: {
  readonly list: Capped<unknown>;
  /** The id of the list element the button expands. */
  readonly controls: string;
}): React.JSX.Element | null {
  if (!list.capped) return null;
  const Icon = list.expanded ? ChevronUpIcon : ChevronDownIcon;
  return (
    <button
      type="button"
      className="list-toggle"
      aria-expanded={list.expanded}
      aria-controls={controls}
      onClick={list.toggle}
    >
      {list.expanded ? "Show fewer" : `Show ${String(list.hidden)} more`}
      <Icon aria-hidden="true" />
    </button>
  );
}
