import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  AttachImportedRequestsSchema,
  ImportedPersonalClaimsSchema,
  type ImportedPersonalClaim,
} from "#shared/personal-migration/contract.ts";
import { readApi, sessionBoundary, writeApi } from "#client/api.ts";

function useAttachImportedRequests(viewerUserId: string) {
  const client = useQueryClient();
  useQuery({
    queryKey: ["attach-imported-requests", viewerUserId],
    // Only mounting My requests should recheck whether attachment is ready.
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async () => {
      const session = sessionBoundary.capture(viewerUserId);
      const result = await writeApi({
        actorId: viewerUserId,
        path: "/requests/imported/attach",
        body: {},
        schema: AttachImportedRequestsSchema,
      });
      if (result.attached === 0) return result;
      const reads = [
        { queryKey: ["requests"] },
        { queryKey: ["movie-requests", 4, viewerUserId] },
        { queryKey: ["request-interests", viewerUserId] },
        { queryKey: ["imported-requests", viewerUserId] },
      ];
      // An initial read may have started before attachment committed.
      await Promise.all(reads.map((read) => client.cancelQueries(read)));
      session.assertCurrent();
      await Promise.all(reads.map((read) => client.invalidateQueries(read)));
      return result;
    },
  });
}

/** Share one request-list query rather than fetching separately for every row. */
export function useImportedRequests(viewerUserId: string) {
  useAttachImportedRequests(viewerUserId);
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
/** Where the request stood in the manager it was imported from. */
function sourceStanding(status: number) {
  switch (status) {
    case 1:
      return "It was still pending there.";
    case 2:
      return "It was approved there.";
    case 3:
      return "It was declined there.";
    case 4:
      return "It had failed there.";
    case 5:
      return "It was fulfilled there.";
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
        Imported from {sourceLabels[claim.sourceKind]}.{" "}
        {sourceStanding(claim.sourceStatus)}
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
            Choose a version
          </Link>
        ) : (
          <p>Waiting for the requester to choose a version.</p>
        ))}
    </div>
  );
}
