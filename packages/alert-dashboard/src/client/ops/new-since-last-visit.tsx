import { Button } from "@shepherdjerred/console-ui";
import { allSignals } from "@shepherdjerred/ops-model/assemble.ts";
import type {
  Signal,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { CheckCheckIcon } from "lucide-react";

import { useMarkSeen } from "./ops-api.ts";
import { SignalList } from "./signal-list.tsx";

/**
 * Every signal that is new since the last "Mark all seen", attention or not.
 * "Needs attention" marks its own new rows with an unread dot; this compact
 * section also keeps the new informational signals that list leaves out.
 */
export function NewSinceLastVisit({
  snapshot,
  areaTitle,
}: {
  readonly snapshot: SnapshotResponse;
  readonly areaTitle: (signal: Signal) => string;
}): React.JSX.Element {
  const markSeen = useMarkSeen();
  const newIds = new Set(snapshot.newSignalIds);
  // A newly healthy check is not news; marking seen still covers every id.
  const fresh = allSignals(snapshot).filter(
    (signal) => newIds.has(signal.id) && signal.severity !== "ok",
  );
  return (
    <section className="home-section" aria-labelledby="new-heading">
      <header className="ui-section-head">
        <h2 className="ui-section-title" id="new-heading">
          New since last visit <span className="ui-count">{fresh.length}</span>
        </h2>
        <Button
          className="section-action"
          disabled={fresh.length === 0 || markSeen.isPending}
          onClick={() => {
            markSeen.mutate(allSignals(snapshot).map((signal) => signal.id));
          }}
        >
          <CheckCheckIcon aria-hidden="true" /> Mark all seen
        </Button>
      </header>
      {markSeen.isError ? (
        <p className="inline-error" role="alert">
          Could not save. Try again.
        </p>
      ) : null}
      <SignalList
        signals={fresh}
        empty="Nothing new since you last marked everything seen."
        label="New since last visit"
        area={areaTitle}
        cap={5}
      />
    </section>
  );
}
