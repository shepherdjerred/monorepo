import type { RecoveryClaimProjection } from "#shared/recovery-claims.ts";
import type { RecoveryDetail } from "#shared/recovery.ts";
import { humanize } from "#client/components.tsx";
import { Badge } from "#client/ui/feedback.tsx";
import { Disclosure, DisclosureList, Panel } from "#client/ui/panel.tsx";
import { Plain, TechnicalDetails, TitleList } from "./parts.tsx";

/** What the requester asked for in the old system. */
const SOURCE_SCOPE_WORDS = {
  movie: "a film",
  series: "a series",
  season: "a season",
} as const satisfies Record<RecoveryClaimProjection["sourceScope"], string>;

/**
 * The old requests this review accounts for, each with the titles it covers.
 * Read only: matching a requester to a person is done from Associate legacy
 * requesters.
 */
export function ClaimEvidencePanel({
  review,
  claims,
}: {
  review: RecoveryDetail;
  claims: readonly RecoveryClaimProjection[];
}) {
  return (
    <Panel
      title="Selected legacy claim evidence"
      description="Requests recorded by the old system that this review accounts for. Identity associations are owner-declared. Current declarations account only for the listed leaves; outside records remain unresolved until separately reviewed."
    >
      <DisclosureList>
        {claims.map((claim) => (
          <Disclosure
            key={`${claim.captureHash}:${claim.provenanceKey}`}
            title={`${humanize(claim.sourceKind)} requester ${claim.requesterSourceId}`}
            meta={
              <Badge>
                Asked for {SOURCE_SCOPE_WORDS[claim.sourceScope]},{" "}
                {claim.mediaIds.length}{" "}
                {claim.mediaIds.length === 1 ? "title" : "titles"} here
              </Badge>
            }
          >
            <Plain>
              {claim.seasons.length > 0
                ? `Captured seasons: ${claim.seasons.join(", ")}. `
                : ""}
              Binding revision {claim.bindingRevision};{" "}
              {claim.outsideMediaIds.length} outside leaves remain outside this
              approval.
            </Plain>
            <TitleList
              label="titles"
              titles={claim.mediaIds.map((mediaId) => ({
                key: mediaId,
                title:
                  review.scope.media.find((item) => item.id === mediaId)
                    ?.title ?? "A title in this review",
              }))}
            />
            <TechnicalDetails
              rows={[
                ["Source instance", claim.sourceInstanceId],
                ["Capture", claim.captureHash],
                ["Record", claim.recordDigest],
              ]}
            />
          </Disclosure>
        ))}
      </DisclosureList>
    </Panel>
  );
}
