import { type ReactElement } from "react";
import type { PrState } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import type { TimelineItem } from "#lib/fold";
import { EvidencePanel } from "./evidence-panel.tsx";
import { Transcript } from "./transcript.tsx";

export function FleetDetail({
  items,
}: {
  items: readonly TimelineItem[];
}): ReactElement {
  return (
    <section className="detail">
      <header className="detail-head">
        <h2>Fleet activity</h2>
        <p className="detail-sub">
          Ticks, reconciliation, and the master conversation.
        </p>
      </header>
      <Transcript items={items} />
    </section>
  );
}

export function PrDetail({
  prNumber,
  state,
  items,
}: {
  prNumber: number;
  state: PrState | null;
  items: readonly TimelineItem[];
}): ReactElement {
  return (
    <section className="detail">
      <header className="detail-head">
        <h2>
          PR #{prNumber}
          {state === null ? null : (
            <span className="detail-title"> {state.identity.title}</span>
          )}
        </h2>
        {state === null ? null : (
          <a
            href={state.identity.url}
            target="_blank"
            rel="noreferrer"
            className="detail-link"
          >
            {state.identity.headRefName} ↗
          </a>
        )}
      </header>
      {state === null ? null : <EvidencePanel pr={state} />}
      <h3 className="transcript-heading">Transcript</h3>
      <Transcript items={items} />
    </section>
  );
}
