import { type ReactElement } from "react";
import type { PrState } from "@shepherdjerred/pr-fleet-controller/src/domain/schemas.ts";
import type { PrProgress, TimelineItem } from "#lib/fold";
import { EvidencePanel } from "./evidence-panel.tsx";
import { OperatorRequest } from "./operator-request.tsx";
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
  progress,
  interactive,
}: {
  prNumber: number;
  state: PrState | null;
  items: readonly TimelineItem[];
  progress: PrProgress | null;
  interactive: boolean;
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
      {progress?.latest === null || progress?.latest === undefined ? null : (
        <section className="progress-panel">
          <h3>Progress</h3>
          <div className="progress-grid">
            <span className="k">latest</span>
            <span className="v">{progress.latest.label}</span>
            <span className="k">at</span>
            <time className="v mono" dateTime={progress.latest.timestamp}>
              {progress.latest.timestamp}
            </time>
            {progress.blocker === null ? null : (
              <>
                <span className="k">blocker</span>
                <span className="v">
                  {progress.blocker.label}
                  {progress.blocker.repeatCount > 1
                    ? ` (${String(progress.blocker.repeatCount)} times)`
                    : ""}
                </span>
              </>
            )}
          </div>
        </section>
      )}
      {state?.operatorRequest === null ||
      state?.operatorRequest === undefined ? null : (
        <OperatorRequest
          key={state.operatorRequest.id}
          request={state.operatorRequest}
          interactive={interactive}
        />
      )}
      <h3 className="transcript-heading">Transcript</h3>
      <Transcript items={items} />
    </section>
  );
}
