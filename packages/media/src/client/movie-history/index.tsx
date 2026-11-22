import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import {
  movieEditionDisplayLabel,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { dateLabel } from "#client/components.tsx";
import { ButtonLink } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, LoadError } from "#client/ui/feedback.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { Plain } from "#client/recovery/parts.tsx";
import { movieReviewPath } from "#client/recovery/paths.ts";
import { readMovieHistoryIndexV3 } from "./api.ts";

/** The reviews waiting on a reader for one edition, or for every film. */
export function MovieHistoryReviewList({
  user,
  scope,
}: {
  user: MediaUser;
  scope?: MovieEditionScope;
}) {
  const owner = user.role === "owner" && !user.restricted;
  const result = useQuery({
    queryKey: [
      "movie-history",
      "pending",
      user.id,
      scope?.mediaId ?? null,
      scope?.edition ?? null,
    ],
    enabled: !owner || scope !== undefined,
    queryFn: () => readMovieHistoryIndexV3(scope),
    refetchInterval: 15_000,
  });
  // The ones still waiting for this reader come first.
  const reviews = [...(result.data?.reviews ?? [])].sort(
    (a, b) => Number(a.responded) - Number(b.responded),
  );
  return (
    <>
      {result.isPending && (
        <SkeletonRows label="Loading movie edition reviews" rows={2} />
      )}
      {result.error !== null && (
        <LoadError
          what="Movie edition reviews"
          error={result.error}
          retry={() => {
            void result.refetch();
          }}
        />
      )}
      {result.data?.reviews.length === 0 && (
        <EmptyNote>
          No pending movie edition reviews need your response.
        </EmptyNote>
      )}
      {reviews.length > 0 && (
        <DataList label="Movie edition reviews">
          {reviews.map((review) => (
            <DataRow
              key={review.id}
              title={review.title}
              detail={`${movieEditionDisplayLabel(review.scope.edition)}. Expires ${dateLabel(review.expiresAt)}.`}
              status={
                review.responded ? (
                  <Badge tone="ok">Your declaration is recorded</Badge>
                ) : (
                  <Badge tone="warn">Your declaration is needed</Badge>
                )
              }
              actions={
                <ButtonLink to={movieReviewPath(review.id)}>
                  {review.responded ? "View review" : "Open review"}
                </ButtonLink>
              }
            />
          ))}
        </DataList>
      )}
    </>
  );
}

/**
 * The movie edition reviews waiting on a reader, answered one film and cut
 * at a time. The owner finds a film's review from the film itself.
 */
export function MovieHistoryIndexV3({
  user,
  scope,
}: {
  user: MediaUser;
  scope?: MovieEditionScope;
}) {
  const owner = user.role === "owner" && !user.restricted;
  return (
    <Panel
      title="Movie edition household reviews"
      description="Choose the edition you want and apply any Keep before the owner captures a review. A later choice, cancellation or Keep needs a fresh review."
    >
      {owner && scope === undefined ? (
        <Plain>
          Open a movie and select its protected edition to find or prepare its
          household review. <ButtonLink to="/discover">Find a movie</ButtonLink>
        </Plain>
      ) : (
        <MovieHistoryReviewList
          user={user}
          {...(scope === undefined ? {} : { scope })}
        />
      )}
    </Panel>
  );
}
