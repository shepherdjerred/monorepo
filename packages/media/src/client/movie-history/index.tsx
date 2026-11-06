import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import {
  movieEditionDisplayLabel,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { ErrorNotice, Loading, dateLabel } from "#client/components.tsx";
import { readMovieHistoryIndexV3 } from "./api.ts";

export function MovieHistoryIndexV3({
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
  return (
    <section className="panel">
      <h2>Movie edition household reviews</h2>
      <p>
        Choose the edition you want and apply any Keep before the owner captures
        a review. A later choice, cancellation or Keep needs a fresh review.
      </p>
      {owner && scope === undefined ? (
        <p>
          Open a movie and select its protected edition to find or prepare its
          household review. <Link to="/">Find a movie</Link>.
        </p>
      ) : (
        <>
          {result.isPending && <Loading />}
          {result.error !== null && <ErrorNotice error={result.error} />}
          {result.data?.reviews.length === 0 && (
            <p>No pending movie edition reviews need your response.</p>
          )}
          <ul>
            {result.data?.reviews.map((review) => (
              <li key={review.id}>
                <Link to={`/recovery/movies/${encodeURIComponent(review.id)}`}>
                  {review.title} —{" "}
                  {movieEditionDisplayLabel(review.scope.edition)}
                </Link>
                <p className="helper">
                  {review.responded
                    ? "Your declaration is recorded"
                    : "Your declaration is needed"}{" "}
                  · Expires {dateLabel(review.expiresAt)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
