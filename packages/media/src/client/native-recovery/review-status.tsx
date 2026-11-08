import { Link } from "react-router";
import { humanize } from "#client/components.tsx";

export function NativeReviewStatus({
  state,
  quarantined,
}: {
  state: string;
  quarantined: boolean;
}) {
  return (
    <section className="panel">
      <h2>{humanize(state)}</h2>
      {quarantined && (
        <p>
          Approval preserves quarantine, subtitle quality and existing retention
          history. Files stay in quarantine until current household intent
          authorizes restoration. This does not prove anyone watched them or
          permit deletion.
        </p>
      )}
      {state === "preparing" && (
        <p>
          Ownership remains unchanged while workers inspect files, subtitles,
          storage and Plex identity.
        </p>
      )}
      {state === "applying" && (
        <p>
          Your approval is queued. Current content and authority will be checked
          again before ownership changes.
        </p>
      )}
      {state === "applied" && (
        <p>
          Physical ownership is restored. Household protection remains active.{" "}
          <Link to="/recovery">Review current household intent</Link> before
          releasing the selected recovery holds.
        </p>
      )}
    </section>
  );
}
