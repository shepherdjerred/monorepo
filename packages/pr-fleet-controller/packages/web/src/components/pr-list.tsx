import { type ReactElement } from "react";
import type { PrState } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

export type PrEntry = { number: number; state: PrState | null };

function checkSummary(pr: PrState): string {
  const checks = pr.evidence.checks;
  if (checks.length === 0) {
    return "no checks";
  }
  const ok = checks.filter((check) => {
    const bucket = check.bucket.toLowerCase();
    return (
      bucket.includes("pass") ||
      bucket.includes("success") ||
      bucket.includes("green")
    );
  }).length;
  return `${String(ok)}/${String(checks.length)} checks`;
}

function Card({
  entry,
  selected,
  onSelect,
}: {
  entry: PrEntry;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  const state = entry.state;
  return (
    <button
      type="button"
      className={`pr-card${selected ? " selected" : ""}`}
      onClick={onSelect}
    >
      <div className="pr-card-top">
        <span className="pr-num">#{entry.number}</span>
        {state === null ? null : (
          <span className={`badge status-${state.classification}`}>
            {state.status}
          </span>
        )}
      </div>
      <div className="pr-title">{state?.identity.title ?? "…"}</div>
      {state === null ? null : (
        <div className="pr-card-meta">
          <span>{checkSummary(state)}</span>
          {state.evidence.reviewFindings.length > 0 ? (
            <span>{state.evidence.reviewFindings.length} findings</span>
          ) : null}
          {state.evidence.conflict ? (
            <span className="conflict">conflict</span>
          ) : null}
          {state.operatorRequest === null ? null : (
            <span className="answer-needed">answer needed</span>
          )}
        </div>
      )}
    </button>
  );
}

export function PrList({
  entries,
  selected,
  onSelect,
}: {
  entries: readonly PrEntry[];
  selected: number | "fleet";
  onSelect: (value: number | "fleet") => void;
}): ReactElement {
  return (
    <nav className="pr-list">
      <button
        type="button"
        className={`pr-card fleet-card${selected === "fleet" ? " selected" : ""}`}
        onClick={() => {
          onSelect("fleet");
        }}
      >
        <span className="pr-num">Fleet</span>
        <div className="pr-card-meta">controller + master activity</div>
      </button>
      {entries.map((entry) => (
        <Card
          key={entry.number}
          entry={entry}
          selected={selected === entry.number}
          onSelect={() => {
            onSelect(entry.number);
          }}
        />
      ))}
    </nav>
  );
}
