import { skipToken, useQuery } from "@tanstack/react-query";
import { api } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";

/** One issue with its comments, relations and attachments. */
export function useIssue(identifier: string | undefined) {
  return useQuery({
    queryKey: ["issue", identifier],
    queryFn:
      identifier === undefined
        ? skipToken
        : () =>
            api.issues.byIdentifier.query({
              identifier,
              viewerActorKey: currentActor().key,
            }),
  });
}
