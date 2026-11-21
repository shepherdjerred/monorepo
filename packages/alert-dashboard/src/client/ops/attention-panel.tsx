import { needsMeSignals } from "@shepherdjerred/ops-model/assemble.ts";
import { actionableSignals } from "@shepherdjerred/ops-model/signals/signal-groups.ts";
import type { SnapshotResponse } from "@shepherdjerred/ops-model/snapshot.ts";

import {
  useAttentionFilter,
  type AttentionFilter,
} from "./attention-filter.ts";
import { SignalList } from "./signal-list.tsx";

const PANEL_ID = "needs-attention";

/** Bring the panel on screen, for a link that changes what it lists. */
export function showAttentionPanel(): void {
  document.querySelector(`#${PANEL_ID}`)?.scrollIntoView({ block: "start" });
}

const EMPTY: Record<AttentionFilter, string> = {
  all: "Nothing needs attention.",
  waiting: "Nothing is waiting on you.",
};

/**
 * Everything to act on, worst first, with a filter down to what waits on
 * Jerred. One list with a filter replaces two lists that mostly repeated
 * each other.
 */
export function AttentionPanel({
  snapshot,
  newIds,
}: {
  readonly snapshot: SnapshotResponse;
  readonly newIds: ReadonlySet<string>;
}): React.JSX.Element {
  const [filter, setFilter] = useAttentionFilter();
  const signals = {
    all: actionableSignals(snapshot),
    waiting: needsMeSignals(snapshot),
  };
  const options: readonly { value: AttentionFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "waiting", label: "Waiting on you" },
  ];
  return (
    <section
      className="panel list-panel attention-panel"
      id={PANEL_ID}
      aria-labelledby="attention-heading"
    >
      <header className="panel-heading">
        <h2 id="attention-heading">Needs attention</h2>
        <div className="segmented" role="radiogroup" aria-label="Show">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === filter}
              onClick={() => {
                setFilter(option.value);
              }}
            >
              {option.label}{" "}
              <span className="segmented-count">
                {signals[option.value].length}
              </span>
            </button>
          ))}
        </div>
      </header>
      {/* Keyed so a list expanded under one filter starts capped under the other. */}
      <SignalList
        key={filter}
        signals={signals[filter]}
        empty={EMPTY[filter]}
        newIds={newIds}
        cap={8}
      />
    </section>
  );
}
