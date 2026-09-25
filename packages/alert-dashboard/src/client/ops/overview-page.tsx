import {
  allSignals,
  attentionSignals,
  needsMeSignals,
} from "@shepherdjerred/ops-model/assemble.ts";
import type { SectionId } from "@shepherdjerred/ops-model/snapshot.ts";
import { CheckCheckIcon } from "lucide-react";

import { useMarkSeen } from "./ops-api.ts";
import {
  PageHeading,
  SectionCard,
  SignalList,
  StatusBanner,
  WithSnapshot,
} from "./ops-ui.tsx";
import { Button } from "#components/button";
import type { SnapshotResponse } from "#shared/ops-schema";

/** Where each section's card links for its detail. */
const SECTION_PAGES: Partial<Record<SectionId, string>> = {
  alerts: "/alerts",
  delivery: "/delivery",
  work: "/delivery",
  ai: "/ai",
  maintenance: "/maintenance",
  errors: "/maintenance",
  platform: "/maintenance",
  observability: "/maintenance",
  product: "/services",
};

function NewSinceLastVisit({
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
        limit={5}
      />
    </section>
  );
}

function Overview({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const newIds = new Set(snapshot.newSignalIds);
  const attention = attentionSignals(snapshot);
  const needsMe = needsMeSignals(snapshot);
  return (
    <>
      <PageHeading eyebrow="Homelab operations" title="Overview" />
      <StatusBanner snapshot={snapshot} />
      <div className="overview-grid">
        <section
          className="panel list-panel attention-panel"
          aria-labelledby="attention-heading"
        >
          <header className="panel-heading">
            <h2 id="attention-heading">
              Needs attention <span className="count">{attention.length}</span>
            </h2>
          </header>
          <SignalList
            signals={attention}
            empty="Nothing needs attention."
            newIds={newIds}
          />
        </section>
        <div className="overview-side">
          <section className="panel list-panel" aria-labelledby="me-heading">
            <header className="panel-heading">
              <h2 id="me-heading">
                Waiting on you <span className="count">{needsMe.length}</span>
              </h2>
            </header>
            <SignalList
              signals={needsMe}
              empty="Nothing is waiting on you."
              newIds={newIds}
            />
          </section>
          <NewSinceLastVisit snapshot={snapshot} />
        </div>
      </div>
      <h2 className="block-heading">Areas</h2>
      <section className="section-grid" aria-label="Areas">
        {snapshot.sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            {...(SECTION_PAGES[section.id] === undefined
              ? {}
              : { to: SECTION_PAGES[section.id] })}
          />
        ))}
      </section>
    </>
  );
}

export function OverviewPage(): React.JSX.Element {
  return (
    <WithSnapshot title="Overview">
      {(snapshot) => <Overview snapshot={snapshot} />}
    </WithSnapshot>
  );
}
