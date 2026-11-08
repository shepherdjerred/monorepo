import { useState } from "react";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import {
  dateLabel,
  ErrorNotice,
  humanize,
  Loading,
  Notice,
  Status,
} from "#client/components.tsx";
import { CommandError } from "#client/target-controls/errors.tsx";
import { MovieEditionSelector } from "./selector.tsx";
import { movieAdmissionReasonV4 } from "./presentation-v4.ts";
import {
  invalidateMovieTargetV4,
  useMovieLifecycleCommandV4,
  useMovieTargetV4,
  type MovieLifecycleControllerV4,
} from "./target-api-v4.ts";
import { MovieReleaseCandidatesV4 } from "./target-releases-v4.tsx";
import { MovieEditionFilesV4 } from "./target-files-v4.tsx";
import { MovieEditionProgressV4 } from "./target-progress-v4.tsx";
import { MovieCaptionReplacementV2 } from "./subtitle-replacement-v2.tsx";
import { MovieHistoryPrepareV3 } from "#client/movie-history/prepare.tsx";
import { MovieRollbackControlV1 } from "./rollback.tsx";

export function MovieEditionControlsV4({
  user,
  mediaId,
}: {
  user: MediaUser;
  mediaId: string;
}) {
  const [edition, setEdition] = useState<MovieEditionKey | "">("");
  const target = useMovieTargetV4(mediaId, edition);
  const action = useMovieLifecycleCommandV4(user.id);
  return (
    <section className="panel">
      <h2>Manage a movie edition</h2>
      <MovieEditionSelector
        value={edition}
        change={setEdition}
        disabled={action.isPending || action.unresolved !== null}
        purpose="manage"
      />
      {edition !== "" && target.isPending && <Loading />}
      {target.error !== null && <ErrorNotice error={target.error} />}
      {target.data !== undefined && (
        <MovieEditionTargetV4
          key={edition}
          user={user}
          context={target.data}
          action={action}
        />
      )}
      <CommandError
        error={action.error}
        review={() => {
          action.reset();
          void invalidateMovieTargetV4(mediaId);
        }}
      />
      {action.unresolved !== null && (
        <Notice>
          <p>
            The result of your last action is unknown. Retry that same action
            before choosing another.
          </p>
          <button
            className="button"
            disabled={action.isPending}
            onClick={action.retryOriginal}
          >
            Retry original action
          </button>
        </Notice>
      )}
      {action.isSuccess && (
        <Notice>
          Edition action accepted. Refresh the edition to review another action.
          <button
            className="button subtle"
            onClick={() => {
              action.reset();
              void invalidateMovieTargetV4(mediaId);
            }}
          >
            Refresh edition
          </button>
        </Notice>
      )}
    </section>
  );
}

function MovieEditionTargetV4({
  user,
  context,
  action,
}: {
  user: MediaUser;
  context: MovieTargetContextV4;
  action: MovieLifecycleControllerV4;
}) {
  if (context.access === "protection_only")
    return (
      <>
        <Notice>
          Library details are unavailable. You can still protect your existing
          edition request.
        </Notice>
        <MovieProtectiveControlsV4 context={context} action={action} />
      </>
    );
  return (
    <>
      <h3>{context.editionLabel}</h3>
      <Status value={context.target.availability} />
      <MovieEditionFilesV4 context={context} />
      <MovieEditionProgressV4 context={context} />
      <MovieCaptionReplacementV2 user={user} context={context} />
      <MovieRollbackControlV1 user={user} scope={context.scope} />
      {user.role === "owner" && context.reasons.includes("recovery_hold") && (
        <MovieHistoryPrepareV3 user={user} scope={context.scope} />
      )}
      <p className="helper">
        Upgrade monitoring: {context.target.monitoring ? "active" : "paused"} ·
        Library policy:{" "}
        {context.target.libraryMonitoring
          ? "monitored"
          : "personal requests only"}
      </p>
      {context.reasons.map((reason) => (
        <p className="helper" key={reason}>
          {movieAdmissionReasonV4(reason)}
        </p>
      ))}
      <MovieProtectiveControlsV4 context={context} action={action} />
      <div className="button-row">
        {context.allowedActions.includes("restore") && (
          <button
            className="button"
            disabled={action.blocked}
            onClick={() => {
              action.submit(context, { action: "restore" });
            }}
          >
            Restore this edition
          </button>
        )}
        {context.allowedActions.includes("retry") && (
          <button
            className="button"
            disabled={action.blocked || user.restricted}
            onClick={() => {
              action.submit(context, { action: "retry" });
            }}
          >
            Retry this edition
          </button>
        )}
      </div>
      {context.allowedActions.includes("remove") && (
        <MovieRemovalReviewV4 context={context} action={action} />
      )}
      {context.allowedActions.includes("select_release") && (
        <MovieReleaseCandidatesV4
          context={context}
          action={action}
          disabled={user.restricted}
        />
      )}
    </>
  );
}

function MovieProtectiveControlsV4({
  context,
  action,
}: {
  context: MovieTargetContextV4;
  action: MovieLifecycleControllerV4;
}) {
  const buttons = [
    "keep",
    context.ownHold?.isPin === true ? "unpin" : "pin",
  ] as const;
  return (
    <>
      <div className="button-row">
        {buttons
          .filter((name) => context.allowedProtectiveActions.includes(name))
          .map((name) => (
            <button
              className="button"
              key={name}
              disabled={action.blocked}
              onClick={() => {
                action.submit(context, { action: name });
              }}
            >
              {humanize(name)} this edition
            </button>
          ))}
      </div>
      {context.ownHold !== null && (
        <p className="helper">
          {context.ownHold.isPin
            ? "Your edition is pinned indefinitely."
            : `Your edition is protected until ${dateLabel(context.ownHold.until)}.`}
        </p>
      )}
    </>
  );
}

function MovieRemovalReviewV4({
  context,
  action,
}: {
  context: Extract<MovieTargetContextV4, { access: "detail" }>;
  action: MovieLifecycleControllerV4;
}) {
  const [review, setReview] = useState<typeof context | null>(null);
  return (
    <details
      className="retention-summary"
      onToggle={(event) => {
        setReview(event.currentTarget.open ? context : null);
      }}
    >
      <summary>Remove this edition from the library</summary>
      <p>
        This moves the selected edition and its owned captions to recoverable
        quarantine and stops its acquisition and upgrade monitoring.
      </p>
      {review?.removalConfirmation != null && (
        <>
          <p>
            Confirm removal of {review.title} — {review.editionLabel}.
          </p>
          <button
            className="button danger"
            disabled={action.blocked}
            onClick={() => {
              if (review.removalConfirmation !== null)
                action.submit(review, {
                  action: "remove",
                  confirmation: review.removalConfirmation,
                });
            }}
          >
            Confirm edition removal
          </button>
        </>
      )}
    </details>
  );
}
