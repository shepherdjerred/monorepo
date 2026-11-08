import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import {
  movieEditionDisplayLabel,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type { PrepareMovieHistoryV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import { ErrorNotice, Loading } from "#client/components.tsx";
import {
  readMovieHistoryContextV3,
  useMovieHistoryWriteV3,
  type MovieHistoryWriteControllerV3,
} from "./api.ts";
import { MovieHistoryIndexV3 } from "./index.tsx";
import { MovieHistoryCommandFeedbackV3 } from "./command-feedback.tsx";

export function MovieHistoryPrepareV3({
  user,
  scope,
}: {
  user: MediaUser;
  scope: MovieEditionScope;
}) {
  return user.role === "owner" && !user.restricted ? (
    <MovieHistoryOwnerPrepareV3
      key={`${scope.mediaId}:${scope.edition}`}
      user={user}
      scope={scope}
    />
  ) : null;
}

function MovieHistoryOwnerPrepareV3({
  user,
  scope,
}: {
  user: MediaUser;
  scope: MovieEditionScope;
}) {
  const [open, setOpen] = useState(false);
  const command = useMovieHistoryWriteV3();
  const result = useQuery({
    queryKey: [
      "movie-history",
      "context",
      user.id,
      scope.mediaId,
      scope.edition,
    ],
    enabled: open,
    queryFn: () => readMovieHistoryContextV3(scope),
  });
  const context = result.data;
  return (
    <details
      className="panel"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        Household history for {movieEditionDisplayLabel(scope.edition)}
      </summary>
      {open && (
        <>
          <MovieHistoryIndexV3 user={user} scope={scope} />
          <p>
            Capture a review after everyone has chosen this edition and applied
            any Keep or pin they want recorded. Classification and household
            monitoring do not create a personal request.
          </p>
          {result.isPending && <Loading />}
          {result.error !== null && <ErrorNotice error={result.error} />}
          {context !== undefined && (
            <MovieHistoryCaptureFormV3
              key={`${String(context.expected.mediaVersion)}:${String(context.expected.targetVersion)}:${String(context.expected.holdVersion)}:${context.expected.definition.definitionDigest}`}
              user={user}
              context={context}
              command={command}
            />
          )}
          <MovieHistoryCommandFeedbackV3 command={command} />
          {command.data !== undefined && (
            <Link
              to={`/recovery/movies/${encodeURIComponent(command.data.recoveryReviewId)}`}
            >
              Open the captured edition review
            </Link>
          )}
        </>
      )}
    </details>
  );
}

function MovieHistoryCaptureFormV3({
  user,
  context,
  command,
}: {
  user: MediaUser;
  context: z.infer<typeof PrepareMovieHistoryV3Schema>;
  command: MovieHistoryWriteControllerV3;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (acknowledged && !command.blocked && !command.isSuccess)
          command.submit({
            actorId: user.id,
            path: "/movie-history/reviews",
            body: context,
          });
      }}
    >
      <label className="check-label">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={command.blocked || command.isSuccess}
          onChange={(event) => {
            setAcknowledged(event.target.checked);
          }}
        />
        I asked each person to set their edition request and any Keep before
        this capture. Everyone will still declare their own present intent.
      </label>
      <button
        className="button"
        type="submit"
        disabled={!acknowledged || command.blocked || command.isSuccess}
      >
        Capture this edition’s review
      </button>
    </form>
  );
}
