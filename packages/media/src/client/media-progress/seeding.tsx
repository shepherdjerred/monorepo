import type { MediaVisibility } from "#shared/visibility/detail.ts";
import { dateLabel, humanize } from "#client/components.tsx";
import {
  cleanupReason,
  policyDescription,
  protectionReason,
} from "./presentation.ts";

type Diagnostics = NonNullable<
  MediaVisibility["torrents"][number]["diagnostics"]
>;

export function SeedingDiagnostics({
  diagnostics,
  currentObservation,
}: {
  diagnostics: Diagnostics;
  currentObservation: boolean;
}) {
  const { obligation, cleanup } = diagnostics;
  return (
    <div className="seed-diagnostics">
      <h4>Seeding & source cleanup</h4>
      <p className="helper">
        Recorded policy · {humanize(diagnostics.providerId)}
      </p>
      <p>{policyDescription(diagnostics)}</p>
      {diagnostics.protections.length > 0 && (
        <div className="progress-protection">
          <strong>Source cleanup is protected</strong>
          <ul>
            {diagnostics.protections.map((reason) => (
              <li key={reason}>{protectionReason(reason)}</li>
            ))}
          </ul>
        </div>
      )}
      {obligation !== null && (
        <p>
          {currentObservation ? "" : "Based on the previous observation: "}
          {cleanupReason(obligation.reason)}
        </p>
      )}
      {cleanup === null ? (
        <p className="helper">
          No source-cleanup evaluation has been recorded.
        </p>
      ) : (
        <div
          className={
            cleanup.freshness === "stale"
              ? "progress-protection"
              : "progress-evaluation"
          }
        >
          <strong>
            {cleanup.freshness === "stale"
              ? "Previous evaluation is stale"
              : cleanup.status === "seeding"
                ? "Seeding requirements pending"
                : "Last source evaluation"}
          </strong>
          <p>
            {cleanup.status === "removed"
              ? "Source removal was recorded."
              : cleanupReason(cleanup.reason)}
          </p>
          <p className="helper">
            {cleanup.phase === "removal" ? "Removal check" : "Seeding check"} ·{" "}
            {dateLabel(cleanup.evaluatedAt)}
          </p>
        </div>
      )}
      <p className="helper">
        Meeting the seeding policy does not authorize deletion. Ownership,
        dependencies and current safety checks still apply.
      </p>
    </div>
  );
}
