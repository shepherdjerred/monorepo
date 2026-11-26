import { Tabs } from "@shepherdjerred/console-ui";
import { needsMeSignals } from "@shepherdjerred/ops-model/assemble.ts";
import { actionableSignals } from "@shepherdjerred/ops-model/signals/signal-groups.ts";
import type {
  Signal,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";

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

function attentionLists(
  snapshot: SnapshotResponse,
): Record<AttentionFilter, Signal[]> {
  return {
    all: actionableSignals(snapshot),
    waiting: needsMeSignals(snapshot),
  };
}

/** Entries the panel shows before "Show N more". */
const ATTENTION_CAP = 8;

/**
 * The filter for "Needs attention" as the header bar's view tabs: everything
 * to act on, or only what waits on Jerred, each with its count.
 */
export function AttentionTabs({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const [filter, setFilter] = useAttentionFilter();
  const lists = attentionLists(snapshot);
  return (
    <Tabs<AttentionFilter>
      label="Needs attention filter"
      options={[
        { value: "all", label: "All", count: lists.all.length },
        {
          value: "waiting",
          label: "Waiting on you",
          count: lists.waiting.length,
        },
      ]}
      value={filter}
      onChange={setFilter}
    />
  );
}

/**
 * Everything to act on, worst first, under one heading row per severity,
 * with the header's tabs narrowing it to what waits on Jerred. New signals
 * carry an unread dot.
 */
export function AttentionPanel({
  snapshot,
  newIds,
  areaTitle,
}: {
  readonly snapshot: SnapshotResponse;
  readonly newIds: ReadonlySet<string>;
  readonly areaTitle: (signal: Signal) => string;
}): React.JSX.Element {
  const [filter] = useAttentionFilter();
  const signals = attentionLists(snapshot)[filter];
  return (
    <section
      className="home-section attention-panel"
      id={PANEL_ID}
      aria-labelledby="attention-heading"
    >
      <header className="ui-section-head">
        <h2 className="ui-section-title" id="attention-heading">
          Needs attention
        </h2>
        <span className="ui-count">
          {filter === "all"
            ? `${String(signals.length)} to act on`
            : `${String(signals.length)} waiting on you`}
        </span>
      </header>
      {/* Keyed so a list expanded under one filter starts capped under the other. */}
      <SignalList
        key={filter}
        signals={signals}
        empty={EMPTY[filter]}
        label="Needs attention"
        newIds={newIds}
        area={areaTitle}
        cap={ATTENTION_CAP}
      />
    </section>
  );
}
