import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  ImportedPersonalClaimsSchema,
  type ImportedPersonalClaim,
} from "#shared/personal-migration/contract.ts";
import { readApi } from "#client/api.ts";

/** Share one request-list query rather than fetching separately for every row. */
export function useImportedRequests(viewerUserId: string) {
  return useQuery({
    queryKey: ["imported-requests", viewerUserId],
    queryFn: () => readApi("/requests/imported", ImportedPersonalClaimsSchema),
    refetchInterval: 15_000,
  });
}

const sourceLabels = {
  seerr: "Seerr",
  overseerr: "Overseerr",
  jellyseerr: "Jellyseerr",
} as const;
function sourceStatusLabel(status: number) {
  switch (status) {
    case 1:
      return "Pending at import";
    case 2:
      return "Approved at import";
    case 3:
      return "Declined at import";
    case 4:
      return "Failed at import";
    case 5:
      return "Fulfilled at import";
    default:
      throw new Error("Unknown imported request status");
  }
}

export function ImportedRequestSource({
  claim,
  viewerUserId,
}: {
  claim: ImportedPersonalClaim;
  viewerUserId: string;
}) {
  return (
    <div className="helper">
      <p>
        Imported from {sourceLabels[claim.sourceKind]} ·{" "}
        {sourceStatusLabel(claim.sourceStatus)}
      </p>
      {claim.sourceFulfilled && (
        <p>
          This records the fulfilled request. Your viewing progress is tracked
          separately.
        </p>
      )}
      {claim.needsAcquisitionChoice &&
        (viewerUserId === claim.userId ? (
          <Link
            className="text-link"
            to={`/media/${encodeURIComponent(claim.mediaId)}`}
          >
            Choose a movie edition
          </Link>
        ) : (
          <p>Waiting for the requester to choose a movie edition.</p>
        ))}
    </div>
  );
}
