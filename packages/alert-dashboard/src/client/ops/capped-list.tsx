import type { Capped } from "@shepherdjerred/console-ui";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

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
