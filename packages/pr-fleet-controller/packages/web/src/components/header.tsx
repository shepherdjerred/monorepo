import { type ReactElement } from "react";
import type {
  RunManifest,
  RunSummary,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import type { FleetSnapshot } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import type { RunStatus } from "#lib/fold";

function statusLabel(runStatus: RunStatus, summary: RunSummary | null): string {
  if (runStatus === "completed") {
    return "completed";
  }
  if (runStatus === "failed") {
    return "failed";
  }
  return summary === null ? "live" : summary.status;
}

function Count({
  label,
  value,
}: {
  label: string;
  value: number;
}): ReactElement {
  return (
    <div className="count">
      <span className="count-value">{value}</span>
      <span className="count-label">{label}</span>
    </div>
  );
}

export function Header({
  manifest,
  summary,
  fleet,
  runStatus,
  connected,
}: {
  manifest: RunManifest | null;
  summary: RunSummary | null;
  fleet: FleetSnapshot | null;
  runStatus: RunStatus;
  connected: boolean;
}): ReactElement {
  const label = statusLabel(runStatus, summary);
  return (
    <header className="app-header">
      <div className="app-title">
        <h1>PR Fleet</h1>
        <span className={`pill pill-${label}`}>{label}</span>
        <span
          className={`dot ${connected ? "dot-live" : "dot-off"}`}
          title={connected ? "streaming" : "disconnected"}
        />
      </div>
      <div className="app-meta">
        {manifest === null ? null : (
          <>
            <span className="mono">{manifest.model}</span>
            <span className="sep">·</span>
            <span className="mono">
              {manifest.controllerCommit.slice(0, 8)}
            </span>
          </>
        )}
      </div>
      {fleet === null ? null : (
        <div className="counts">
          <Count label="open" value={fleet.open} />
          <Count label="green" value={fleet.green} />
          <Count label="active" value={fleet.active} />
          <Count label="queued" value={fleet.queued} />
          <Count label="pending" value={fleet.pending} />
          <Count label="paused" value={fleet.paused} />
        </div>
      )}
    </header>
  );
}
