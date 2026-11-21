import { allSignals } from "@shepherdjerred/ops-model/assemble.ts";
import type { SnapshotResponse } from "@shepherdjerred/ops-model/snapshot.ts";
import { CheckCheckIcon } from "lucide-react";

import { useMarkSeen } from "./ops-api.ts";
import { SignalList } from "./signal-list.tsx";
import { Button } from "#components/button";

export function NewSinceLastVisit({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const markSeen = useMarkSeen();
  const newIds = new Set(snapshot.newSignalIds);
  // A newly healthy check is not news; marking seen still covers every id.
  const fresh = allSignals(snapshot).filter(
    (signal) => newIds.has(signal.id) && signal.severity !== "ok",
  );
  return (
    <section className="panel list-panel" aria-labelledby="new-heading">
      <header className="panel-heading">
        <h2 id="new-heading">
          New since last visit <span className="count">{fresh.length}</span>
        </h2>
        <Button
          type="button"
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
        cap={5}
      />
    </section>
  );
}
