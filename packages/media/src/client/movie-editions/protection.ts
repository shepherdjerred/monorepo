import { useMutation } from "@tanstack/react-query";
import {
  CancelMovieRequestV3Schema,
  RevokeMovieEditionChoiceV3Schema,
  CancelMovieRequestResultV3Schema,
  RevokeMovieEditionChoiceResultV3Schema,
  type CancelMovieRequestV3,
  type RevokeMovieEditionChoiceV3,
} from "#shared/movie-editions/commands.ts";
import type { MovieEditionRequestView } from "#shared/movie-editions/view.ts";
import { ApiError, writeApi } from "#client/api.ts";
import { commandNeedsReview } from "#client/target-controls/errors.tsx";
import { invalidateMovieRequests } from "./api.ts";

export type MovieProtectionSubmission = {
  actorId: string;
  path: string;
  body: CancelMovieRequestV3 | RevokeMovieEditionChoiceV3;
};
type ProtectionResult = {
  error: Error | null;
  variables: MovieProtectionSubmission | undefined;
};

export function movieProtectionSubmission(input: {
  actorId: string;
  subjectUserId: string;
  request: MovieEditionRequestView;
  action: "cancel_request" | "revoke_choice";
}): MovieProtectionSubmission {
  const { request, action } = input;
  const schema =
    action === "cancel_request"
      ? CancelMovieRequestV3Schema
      : RevokeMovieEditionChoiceV3Schema;
  const body = schema.parse({
    schemaVersion: 3,
    subjectUserId: input.subjectUserId,
    scope: request.scope,
    requestId: request.requestId,
    action,
    expected: {
      targetVersion: request.targetVersion,
      requestVersion: request.requestVersion,
      choiceRevision: request.choiceRevision,
    },
  });
  const suffix = action === "cancel_request" ? "cancel" : "revoke-choice";
  return {
    actorId: input.actorId,
    path: `/media/${encodeURIComponent(body.scope.mediaId)}/movie-requests/${encodeURIComponent(body.requestId)}/${suffix}`,
    body,
  };
}

export function unresolvedMovieProtection(
  previous: ProtectionResult,
): MovieProtectionSubmission | null {
  if (previous.error === null || previous.variables === undefined) return null;
  return previous.error instanceof ApiError &&
    previous.error.status >= 400 &&
    previous.error.status < 500
    ? null
    : previous.variables;
}

export function movieProtectionAttempt(
  previous: ProtectionResult,
  proposed: MovieProtectionSubmission,
): MovieProtectionSubmission {
  if (previous.error !== null && commandNeedsReview(previous.error))
    throw previous.error;
  return unresolvedMovieProtection(previous) ?? proposed;
}

export function protectionRetryLabel(input: MovieProtectionSubmission): string {
  return input.body.action === "cancel_request"
    ? "Retry original cancellation"
    : "Retry original revocation";
}

export function movieProtectionMutationOptions() {
  return {
    mutationFn: async (input: MovieProtectionSubmission) => {
      const common = {
        actorId: input.actorId,
        path: input.path,
        version: 3 as const,
        body: input.body,
      };
      return input.body.action === "cancel_request"
        ? writeApi({ ...common, schema: CancelMovieRequestResultV3Schema })
        : writeApi({
            ...common,
            schema: RevokeMovieEditionChoiceResultV3Schema,
          });
    },
    onSuccess: (_result: unknown, input: MovieProtectionSubmission) =>
      invalidateMovieRequests(input.body.scope.mediaId),
    retry: false as const,
  };
}

export function useMovieProtection() {
  const mutation = useMutation(movieProtectionMutationOptions());
  return {
    ...mutation,
    submit: (input: MovieProtectionSubmission) => {
      if (!commandNeedsReview(mutation.error))
        mutation.mutate(movieProtectionAttempt(mutation, input));
    },
  };
}
