import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import {
  ActivateMovieEditionChoiceV4Schema,
  ActivateMovieEditionChoiceResultV4Schema,
  type ActivateMovieEditionChoiceV4,
  type MovieEditionRequestViewV4Schema,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import { ApiError, writeApi } from "#client/api.ts";
import { CommandError } from "#client/target-controls/errors.tsx";
import { readMovieContextV4 } from "./request-api-v4.ts";
import { invalidateMovieRequests } from "./api.ts";
import { movieAdmissionReasonV4 } from "./presentation-v4.ts";

type Request = z.infer<typeof MovieEditionRequestViewV4Schema>;

/** Activate only the same saved choice shown to the user; changed consent requires another review. */
export async function reviewMovieActivationV4(
  request: Request,
  subjectUserId: string,
) {
  const context = await readMovieContextV4(
    request.scope.mediaId,
    subjectUserId,
  );
  const current = context.options.find(
    (option) => option.edition === request.scope.edition,
  );
  const choice = current?.request;
  if (current === undefined || choice?.choiceId == null) activationChanged();
  if (
    !current.activationRequired ||
    choice.id !== request.requestId ||
    choice.choiceId !== request.choiceId ||
    choice.choiceRevision !== request.choiceRevision ||
    choice.version !== request.requestVersion ||
    current.targetVersion !== request.targetVersion
  )
    activationChanged();
  if (current.acquisition === "protected") {
    if (current.reasons.length === 0)
      throw new Error("Protected movie choice has no admission reason");
    throw new ApiError(
      "movie_activation_protected",
      current.reasons.map((reason) => movieAdmissionReasonV4(reason)).join(" "),
      503,
    );
  }
  return ActivateMovieEditionChoiceV4Schema.parse({
    schemaVersion: 4,
    scope: request.scope,
    subjectUserId,
    requestId: choice.id,
    choiceId: choice.choiceId,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: current.targetVersion,
      requestVersion: choice.version,
      choiceRevision: choice.choiceRevision,
    },
  });
}

export function ActivateMovieChoiceV4({
  actorId,
  subjectUserId,
  request,
  disabled,
}: {
  actorId: string;
  subjectUserId: string;
  request: Request;
  disabled: boolean;
}) {
  const pending = useRef<ActivateMovieEditionChoiceV4 | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const input =
        pending.current ??
        (await reviewMovieActivationV4(request, subjectUserId));
      pending.current = input;
      return writeApi({
        actorId,
        path: `/media/${encodeURIComponent(input.scope.mediaId)}/movie-requests/${encodeURIComponent(input.requestId)}/activate-choice`,
        version: 4,
        body: input,
        schema: ActivateMovieEditionChoiceResultV4Schema.refine(
          (result) =>
            result.requestId === input.requestId &&
            result.choiceId === input.choiceId &&
            result.mediaId === input.scope.mediaId &&
            result.edition === input.scope.edition &&
            result.subjectUserId === input.subjectUserId,
          "Activation response belongs to another saved choice",
        ),
      });
    },
    onSuccess: async () => {
      pending.current = null;
      await invalidateMovieRequests(request.scope.mediaId);
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      )
        pending.current = null;
    },
  });
  return (
    <>
      <button
        className="button"
        disabled={
          disabled ||
          mutation.isPending ||
          mutation.isSuccess ||
          (mutation.error instanceof ApiError && mutation.error.status === 409)
        }
        onClick={() => {
          mutation.mutate();
        }}
      >
        {mutation.isPending
          ? "Starting saved choice…"
          : pending.current === null
            ? "Start saved edition choice"
            : "Retry original activation"}
      </button>
      <CommandError
        error={mutation.error}
        review={() => {
          pending.current = null;
          mutation.reset();
          void invalidateMovieRequests(request.scope.mediaId);
        }}
      />
      {mutation.isSuccess && (
        <p role="status">Your saved edition choice is queued.</p>
      )}
    </>
  );
}

function activationChanged(): never {
  throw new ApiError(
    "movie_choice_changed",
    "Review the latest saved edition choice before starting it.",
    409,
  );
}
