import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import {
  MovieEditionRequestListV3Schema,
  type MovieEditionRequestView,
} from "#shared/movie-editions/view.ts";
import { readApi } from "#client/api.ts";
import { ErrorNotice, Loading } from "#client/components.tsx";
import {
  CommandError,
  commandNeedsReview,
} from "#client/target-controls/errors.tsx";
import { ListedMediaAction } from "#client/target-controls/protection.tsx";
import { invalidateMovieRequests } from "./api.ts";
import { MovieRequestSubject } from "./subject.tsx";
import { movieFulfillmentLabel } from "./presentation.ts";
import {
  movieProtectionSubmission,
  protectionRetryLabel,
  unresolvedMovieProtection,
  useMovieProtection,
} from "./protection.ts";

export function MovieRequests({ user }: { user: MediaUser }) {
  const [subjectUserId, setSubjectUserId] = useState(user.id);
  return (
    <section className="panel">
      <h2>Movie edition requests</h2>
      <MovieRequestSubject
        user={user}
        subjectUserId={subjectUserId}
        change={setSubjectUserId}
      />
      <MovieRequestPage
        key={subjectUserId}
        user={user}
        subjectUserId={subjectUserId}
      />
    </section>
  );
}

function MovieRequestPage({
  user,
  subjectUserId,
}: {
  user: MediaUser;
  subjectUserId: string;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const requests = useQuery({
    queryKey: ["movie-requests", subjectUserId, cursor],
    queryFn: async () =>
      readApi(
        `/movie-requests?subjectUserId=${encodeURIComponent(subjectUserId)}${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
        MovieEditionRequestListV3Schema,
        3,
      ),
    refetchInterval: 15_000,
  });
  const nextCursor = requests.data?.nextCursor;
  return (
    <>
      {requests.isPending && <Loading />}
      {requests.error !== null && <ErrorNotice error={requests.error} />}
      {requests.data?.items.length === 0 && (
        <p>No movie requests on this page.</p>
      )}
      {requests.data?.items.map((request) => (
        <MovieRequestRow
          key={request.requestId}
          user={user}
          subjectUserId={subjectUserId}
          request={request}
        />
      ))}
      <div className="button-row">
        {cursor !== null && (
          <button
            className="button"
            onClick={() => {
              setCursor(null);
            }}
          >
            First page
          </button>
        )}
        {nextCursor !== null && nextCursor !== undefined && (
          <button
            className="button"
            onClick={() => {
              setCursor(nextCursor);
            }}
          >
            Next page
          </button>
        )}
      </div>
    </>
  );
}

function MovieRequestRow({
  user,
  subjectUserId,
  request,
}: {
  user: MediaUser;
  subjectUserId: string;
  request: MovieEditionRequestView;
}) {
  const mutation = useMovieProtection();
  const unresolved = unresolvedMovieProtection(mutation);
  const disabled =
    mutation.isPending ||
    commandNeedsReview(mutation.error) ||
    unresolved !== null;
  function submit(action: "cancel_request" | "revoke_choice") {
    mutation.submit(
      movieProtectionSubmission({
        actorId: user.id,
        subjectUserId,
        request,
        action,
      }),
    );
  }
  async function reviewLatest() {
    await invalidateMovieRequests(request.scope.mediaId);
    mutation.reset();
  }
  return (
    <article className="request-row">
      <div className="item-main">
        {request.access === "detail" ? (
          <>
            <Link to={`/media/${encodeURIComponent(request.scope.mediaId)}`}>
              {request.title}
            </Link>
            <p>
              {request.fulfillment.status === "pending_choice"
                ? "Edition not selected"
                : request.editionLabel}
              {request.year === null ? "" : ` · ${String(request.year)}`}
            </p>
          </>
        ) : (
          <>
            <strong>Your movie request</strong>
            <p>Request protections only; library details unavailable.</p>
          </>
        )}
        <p role="status">
          {request.active
            ? movieFulfillmentLabel(request.fulfillment)
            : "Request cancelled"}
        </p>
        {request.active &&
          unresolved === null &&
          request.fulfillment.status === "pending_choice" &&
          request.access === "detail" && (
            <Link
              className="text-link"
              to={`/media/${encodeURIComponent(request.scope.mediaId)}`}
            >
              Choose a movie edition
            </Link>
          )}
        <div className="button-row">
          {request.active && request.canCancel && (
            <button
              className="button subtle"
              disabled={disabled}
              onClick={() => {
                submit("cancel_request");
              }}
            >
              Cancel request
            </button>
          )}
          {request.active && request.canRevokeChoice && (
            <button
              className="button subtle"
              disabled={disabled}
              onClick={() => {
                submit("revoke_choice");
              }}
            >
              Clear edition choice, keep request
            </button>
          )}
          {request.active &&
            !disabled &&
            request.scope.edition === "default" &&
            subjectUserId === user.id && (
              <ListedMediaAction
                user={user}
                mediaId={request.scope.mediaId}
                action="keep"
              />
            )}
        </div>
        <ProtectionFeedback mutation={mutation} review={reviewLatest} />
      </div>
    </article>
  );
}

function ProtectionFeedback({
  mutation,
  review,
}: {
  mutation: ReturnType<typeof useMovieProtection>;
  review: () => Promise<void>;
}) {
  const unresolved = unresolvedMovieProtection(mutation);
  return (
    <>
      {unresolved !== null && (
        <div role="status">
          <p>
            The earlier action’s result is unknown. Retry that exact action
            before making another change.
          </p>
          <button
            className="button subtle"
            disabled={mutation.isPending}
            onClick={() => {
              mutation.submit(unresolved);
            }}
          >
            {protectionRetryLabel(unresolved)}
          </button>
        </div>
      )}
      <CommandError
        error={mutation.error}
        review={() => {
          void review();
        }}
      />
      {mutation.data !== undefined && (
        <p role="status">
          {mutation.data.state === "cancelled"
            ? "Cancellation confirmed. The current request status is shown above."
            : "Revocation confirmed. The current request status is shown above."}
        </p>
      )}
    </>
  );
}
