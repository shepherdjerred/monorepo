import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieRollbackViewV1 } from "#shared/movie-editions/rollback/view.ts";
import {
  dateLabel,
  ErrorNotice,
  Loading,
  Notice,
} from "#client/components.tsx";
import { CommandError } from "#client/target-controls/errors.tsx";
import {
  movieRollbackSubmissionV1,
  readMovieRollbackV1,
  useMovieRollbackCommandV1,
  type RollbackReviewV1,
  type MovieRollbackControllerV1,
} from "./rollback-api.ts";

const unavailable: Record<
  Extract<MovieRollbackViewV1, { state: "unavailable" }>["reason"],
  string
> = {
  no_current_movie:
    "This edition has no current owned movie file to roll back.",
  no_retained_predecessor:
    "No retained previous video is available for this edition.",
  rollback_window_closed: "The original recovery window has closed.",
  current_pair_protected:
    "The current file pair needs recovery review before it can change.",
  playback_scope_unconfigured:
    "Configure this movie's Plex library before reviewing recovery.",
};
export function MovieRollbackControlV1({
  user,
  scope,
}: {
  user: MediaUser;
  scope: MovieEditionScope;
}) {
  const [open, setOpen] = useState(false);
  const command = useMovieRollbackCommandV1();
  const result = useQuery({
    queryKey: ["movie-rollback", scope.mediaId, scope.edition, user.id],
    enabled: open && user.role === "owner" && !user.restricted,
    queryFn: () => readMovieRollbackV1(scope),
    refetchInterval: open ? 5000 : false,
  });
  if (user.role !== "owner" || user.restricted) return null;
  const review = result.data;
  function refresh() {
    command.reset();
    void result.refetch();
  }
  return (
    <details
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>Recover the previous file for this edition</summary>
      {open && (
        <>
          {result.isPending && <Loading />}
          {result.error !== null && <ErrorNotice error={result.error} />}
          <CommandError error={command.error} review={refresh} />
          {command.unknown !== null && (
            <Notice>
              <p>The outcome is unknown. Retry the original reviewed action.</p>
              <button
                className="button"
                disabled={command.isPending}
                onClick={command.retryOriginal}
              >
                Retry original recovery action
              </button>
            </Notice>
          )}
          {command.data !== undefined && (
            <Notice>
              Recovery command accepted. Current playback and file ownership are
              checked before effects.
              <button className="button subtle" onClick={refresh}>
                Review current recovery state
              </button>
            </Notice>
          )}
          {review !== undefined && (
            <>
              <h4>
                {review.title} · {review.editionLabel}
              </h4>
              <MovieRollbackFilesV1 review={review} />
              <MovieRollbackStateV1 review={review} />
              {(review.state === "request" || review.state === "retry") && (
                <MovieRollbackReviewFormV1
                  key={JSON.stringify(review.command)}
                  actorId={user.id}
                  review={review}
                  command={command}
                />
              )}
            </>
          )}
        </>
      )}
    </details>
  );
}
function MovieRollbackFilesV1({ review }: { review: MovieRollbackViewV1 }) {
  return (
    <>
      {review.predecessor !== null && (
        <p>
          Previous file: {review.predecessor.quality} ·{" "}
          {review.predecessor.codec} · Audio:{" "}
          {review.predecessor.audioLanguages.join(", ")}
        </p>
      )}
      {review.successor !== null && (
        <p>
          Newer file: {review.successor.quality} · {review.successor.codec} ·
          Audio: {review.successor.audioLanguages.join(", ")}
        </p>
      )}
      {review.originalDeadline !== null && (
        <p>Original recovery deadline: {dateLabel(review.originalDeadline)}.</p>
      )}
    </>
  );
}
function MovieRollbackStateV1({ review }: { review: MovieRollbackViewV1 }) {
  switch (review.state) {
    case "unavailable":
      return <p>{unavailable[review.reason]}</p>;
    case "in_progress":
      return (
        <p>
          {review.reason === "workflow_running"
            ? "Recovery is still running. Wait for its current executor to settle."
            : "The previous executor's state is unknown. Recovery remains protected."}
        </p>
      );
    case "completed":
      return (
        <p>The admitted file rollback and Plex verification are complete.</p>
      );
    case "request":
      return (
        <p>
          Restore the exact retained video and its owned captions. The newer
          video and its captions remain in recovery storage. Current Plex
          playback must be idle.
        </p>
      );
    case "retry":
      return (
        <p>
          Resume the already admitted rollback after the previous executor
          stopped. It continues the same file journals and original recovery
          window.
        </p>
      );
  }
}
function MovieRollbackReviewFormV1({
  actorId,
  review,
  command,
}: {
  actorId: string;
  review: RollbackReviewV1;
  command: MovieRollbackControllerV1;
}) {
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          command.submit(
            movieRollbackSubmissionV1(
              actorId,
              review,
              new FormData(event.currentTarget),
            ),
          );
        } catch (error_) {
          if (!(error_ instanceof Error)) throw error_;
          setError(error_);
        }
      }}
    >
      <fieldset disabled={command.blocked}>
        <legend>Confirm {review.editionLabel} recovery</legend>
        <label>
          Reason
          <textarea name="reason" required minLength={10} maxLength={2000} />
        </label>
        {review.state === "request" ? (
          <>
            <label className="check-label">
              <input name="restore" type="checkbox" required />
              Restore this exact previous video and its captions.
            </label>
            <label className="check-label">
              <input name="retain" type="checkbox" required />
              Retain the rejected newer file and its captions for recovery.
            </label>
          </>
        ) : (
          <label className="check-label">
            <input name="resume" type="checkbox" required />
            Resume the exact admitted rollback without extending its original
            window.
          </label>
        )}
        <button className="button" disabled={command.blocked}>
          {review.state === "request"
            ? "Restore reviewed previous file"
            : "Resume admitted rollback"}
        </button>
      </fieldset>
      {error !== null && <ErrorNotice error={error} />}
    </form>
  );
}
