import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import {
  PageTitle,
  Loading,
  ErrorNotice,
  dateLabel,
  Status,
} from "#client/components.tsx";
import {
  movieHistoryReviewViewV3,
  readMovieHistoryReviewV3,
  useMovieHistoryWriteV3,
} from "./api.ts";
import { movieHistoryPersonV3, movieHistorySubjectsV3 } from "./declaration.ts";
import { MovieHistoryCommandFeedbackV3 } from "./command-feedback.tsx";
import { MovieHistoryResponseFormV3 } from "./response.tsx";
import { MovieHistoryReleaseV3 } from "./release.tsx";

export function MovieHistoryPageV3({ user }: { user: MediaUser }) {
  const { id } = useParams();
  if (id === undefined)
    throw new Error("Movie history route requires a review");
  return (
    <MovieHistoryReviewPageV3 key={`${user.id}:${id}`} user={user} id={id} />
  );
}

function MovieHistoryReviewPageV3({
  user,
  id,
}: {
  user: MediaUser;
  id: string;
}) {
  const command = useMovieHistoryWriteV3();
  const result = useQuery({
    queryKey: ["movie-history", "review", user.id, id],
    queryFn: () => readMovieHistoryReviewV3(id),
    refetchInterval: 5000,
  });
  const review = result.data;
  if (review === undefined)
    return result.error === null ? (
      <Loading />
    ) : (
      <ErrorNotice error={result.error} />
    );
  const view = movieHistoryReviewViewV3(review);
  const scope =
    view.kind === "owner" ? view.review.scope.scope : view.review.scope;
  const title =
    view.kind === "owner" ? view.review.scope.media.title : view.review.title;
  const closed =
    review.state !== "awaiting_responses" ||
    Date.parse(review.expiresAt) <= Date.now();
  const subjects = movieHistorySubjectsV3(review, user);
  return (
    <>
      <PageTitle
        eyebrow="Present household intent"
        title={`${title} — ${movieEditionDisplayLabel(scope.edition)}`}
      >
        <p>
          This review records the chosen edition and present intent. It never
          reconstructs old requests or creates a Keep.
        </p>
      </PageTitle>
      <p>
        <Link to="/recovery">All recovery reviews</Link> ·{" "}
        <Link to={`/media/${encodeURIComponent(scope.mediaId)}`}>
          Movie edition controls
        </Link>
      </p>
      <section className="panel">
        <Status value={review.state} />
        <p>Expires {dateLabel(review.expiresAt)}.</p>
        <p>
          A changed request, choice or Keep requires the owner to capture a
          fresh review. Positive declarations refer only to choices already
          captured here. Independent people declare for themselves.
        </p>
        {closed && (
          <p>
            This review is closed or expired. It cannot accept new declarations
            or release authority.
          </p>
        )}
      </section>
      {result.error !== null && <ErrorNotice error={result.error} />}
      <MovieHistoryCommandFeedbackV3 command={command} />
      {subjects.map((subject) => (
        <MovieHistoryResponseFormV3
          key={`${review.id}:${String(review.version)}:${review.scopeHash}:${subject.id}`}
          user={user}
          person={movieHistoryPersonV3(review, subject)}
          command={command}
          closed={closed}
        />
      ))}
      {view.kind === "owner" && user.role === "owner" && !user.restricted && (
        <MovieHistoryReleaseV3
          key={`${review.id}:${String(review.version)}:${view.review.responseHash}`}
          user={user}
          review={view.review}
          command={command}
          closed={closed}
        />
      )}
    </>
  );
}
