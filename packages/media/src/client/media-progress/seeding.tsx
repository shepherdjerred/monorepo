import type { MediaVisibility } from "#shared/visibility/detail.ts";
import { dateLabel, humanize } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Badge, Callout } from "#client/ui/feedback.tsx";
import { Disclosure } from "#client/ui/panel.tsx";
import {
  cleanupReason,
  policyDescription,
  protectionReason,
} from "./presentation.ts";
import styles from "./progress.module.css";

const cx = classNames(styles);

type Diagnostics = NonNullable<
  MediaVisibility["torrents"][number]["diagnostics"]
>;

/**
 * Why a download's source is or is not safe to clean up. Closed until
 * asked for; when something protects the source the summary says so.
 */
export function SeedingDiagnostics({
  diagnostics,
  currentObservation,
}: {
  diagnostics: Diagnostics;
  currentObservation: boolean;
}) {
  const { obligation, cleanup } = diagnostics;
  return (
    <Disclosure
      title="Seeding and source cleanup"
      meta={
        diagnostics.protections.length > 0 ? (
          <Badge tone="warn">Protected</Badge>
        ) : undefined
      }
    >
      <div className={cx("diagnostics")}>
        <p className={cx("muted")}>
          Recorded policy from {humanize(diagnostics.providerId)}
        </p>
        <p>{policyDescription(diagnostics)}</p>
        {diagnostics.protections.length > 0 && (
          <Callout tone="warn" title="Source cleanup is protected">
            <ul className={cx("reasons")}>
              {diagnostics.protections.map((reason) => (
                <li key={reason}>{protectionReason(reason)}</li>
              ))}
            </ul>
          </Callout>
        )}
        {obligation !== null && (
          <p>
            {currentObservation ? "" : "Based on the previous observation: "}
            {cleanupReason(obligation.reason)}
          </p>
        )}
        {cleanup === null ? (
          <p className={cx("muted")}>
            No source-cleanup evaluation has been recorded.
          </p>
        ) : (
          <Callout
            tone={cleanup.freshness === "stale" ? "warn" : "neutral"}
            title={
              cleanup.freshness === "stale"
                ? "Previous evaluation is stale"
                : cleanup.status === "seeding"
                  ? "Seeding requirements pending"
                  : "Last source evaluation"
            }
          >
            <p>
              {cleanup.status === "removed"
                ? "Source removal was recorded."
                : cleanupReason(cleanup.reason)}
            </p>
            <p className={cx("muted")}>
              {cleanup.phase === "removal" ? "Removal check" : "Seeding check"},{" "}
              {dateLabel(cleanup.evaluatedAt)}
            </p>
          </Callout>
        )}
        <p className={cx("muted")}>
          Meeting the seeding policy does not authorize deletion. Ownership,
          dependencies and current safety checks still apply.
        </p>
      </div>
    </Disclosure>
  );
}
