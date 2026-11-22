import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import {
  MovieEditionRequestListV4Schema,
  type MovieEditionRequestViewV4Schema,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { z } from "zod";
import { readApi } from "#client/api.ts";
import {
  CommandError,
  commandNeedsReview,
} from "#client/target-controls/errors.tsx";
import { MovieListedKeepV4 } from "./listed-keep-v4.tsx";
import { invalidateMovieRequests } from "./api.ts";
import { ActivateMovieChoiceV4 } from "./activation-v4.tsx";
import { movieFulfillmentLabel } from "./presentation.ts";
import {
  movieProtectionSubmission,
  protectionRetryLabel,
  unresolvedMovieProtection,
  useMovieProtection,
} from "./protection-v4.ts";

type MovieRequest = z.infer<typeof MovieEditionRequestViewV4Schema>;

/** One page of a person's film requests; the answer must be that person's. */
export function readMovieRequests(
  subjectUserId: string,
  cursor: string | null,
) {
  const params = new URLSearchParams({ subjectUserId });
  if (cursor !== null) params.set("cursor", cursor);
  return readApi(
    `/movie-requests?${params.toString()}`,
    MovieEditionRequestListV4Schema.refine(
      (page) => page.subjectUserId === subjectUserId,
      "Movie requests belong to another profile",
    ),
    4,
  );
}

/**
 * Where one film request stands and everything its requester can do about
 * it: start looking for a chosen version, cancel, clear the version, or
 * hold it for 30 days. The title it belongs to is named by whatever lists it.
 */
export function MovieRequestControls({
  user,
  subjectUserId,
  request,
}: {
  user: MediaUser;
  subjectUserId: string;
  request: MovieRequest;
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
    <>
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
            Choose a version
          </Link>
        )}
      <div className="action-row">
        <SavedMovieChoice
          user={user}
          subjectUserId={subjectUserId}
          request={request}
          disabled={disabled}
        />
        {request.active && request.canCancel && (
          <button
            className="button subtle"
            type="button"
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
            type="button"
            disabled={disabled}
            onClick={() => {
              submit("revoke_choice");
            }}
          >
            Clear the version, keep the request
          </button>
        )}
        {request.active && !disabled && subjectUserId === user.id && (
          <MovieListedKeepV4 actorId={user.id} scope={request.scope} />
        )}
      </div>
      <ProtectionFeedback mutation={mutation} review={reviewLatest} />
    </>
  );
}

function SavedMovieChoice({
  user,
  subjectUserId,
  request,
  disabled,
}: {
  user: MediaUser;
  subjectUserId: string;
  request: MovieRequest;
  disabled: boolean;
}) {
  if (
    !request.active ||
    !request.activationRequired ||
    request.access !== "detail"
  )
    return null;
  return (
    <ActivateMovieChoiceV4
      actorId={user.id}
      subjectUserId={subjectUserId}
      request={request}
      disabled={disabled || user.restricted}
    />
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
            Media does not know whether that went through. Try it again before
            doing anything else.
          </p>
          <button
            className="button subtle"
            type="button"
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
            ? "Request cancelled."
            : "Version cleared. The request is kept."}
        </p>
      )}
    </>
  );
}
