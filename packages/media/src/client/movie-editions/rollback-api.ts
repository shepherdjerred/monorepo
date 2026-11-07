import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  MovieRollbackViewV1Schema,
  type MovieRollbackViewV1,
} from "#shared/movie-editions/rollback/view.ts";
import {
  RequestMovieRollbackV1Schema,
  RequestMovieRollbackResultV1Schema,
} from "#shared/movie-editions/rollback/manual-command.ts";
import {
  RequestMovieRollbackRetryV1Schema,
  RequestMovieRollbackRetryResultV1Schema,
} from "#shared/movie-editions/rollback/retry.ts";
import { ApiError, queryClient, readApi, writeApi } from "#client/api.ts";
import { commandNeedsReview } from "#client/target-controls/errors.tsx";

export type RollbackReviewV1 = Extract<
  MovieRollbackViewV1,
  { state: "request" | "retry" }
>;
type Submission = {
  actorId: string;
  path: string;
  body:
    | z.infer<typeof RequestMovieRollbackV1Schema>
    | z.infer<typeof RequestMovieRollbackRetryV1Schema>;
};
function base(scope: MovieEditionScope) {
  return `/media/${scope.mediaId}/movie-editions/${scope.edition}/rollback`;
}
export function readMovieRollbackV1(scope: MovieEditionScope) {
  return readApi(
    base(scope),
    MovieRollbackViewV1Schema.refine(
      (value) =>
        value.scope.rootMediaId === scope.rootMediaId &&
        value.scope.mediaId === scope.mediaId &&
        value.scope.edition === scope.edition,
      "Rollback review belongs to another movie edition",
    ),
    4,
  );
}
export function movieRollbackSubmissionV1(
  actorId: string,
  review: RollbackReviewV1,
  form: FormData,
): Submission {
  const reason = form.get("reason");
  return review.state === "request"
    ? {
        actorId,
        path: base(review.scope),
        body: RequestMovieRollbackV1Schema.parse({
          ...review.command,
          reason,
          confirmRestorePredecessor: form.get("restore") === "on",
          confirmRetainRejectedSuccessor: form.get("retain") === "on",
        }),
      }
    : {
        actorId,
        path: `${base(review.scope)}/retry`,
        body: RequestMovieRollbackRetryV1Schema.parse({
          ...review.command,
          reason,
          confirmResumeAdmittedRollback: form.get("resume") === "on",
        }),
      };
}
export function writeMovieRollbackV1(input: Submission) {
  return writeApi({
    ...input,
    version: 4,
    schema: z
      .union([
        RequestMovieRollbackResultV1Schema,
        RequestMovieRollbackRetryResultV1Schema,
      ])
      .refine(
        (value) =>
          value.scope.mediaId === input.body.scope.mediaId &&
          value.scope.edition === input.body.scope.edition &&
          value.sourceAttemptId === input.body.sourceAttemptId,
        "Rollback acknowledgement belongs to another reviewed edition",
      ),
  });
}
function unresolved(previous: {
  error: Error | null;
  variables: Submission | undefined;
}) {
  if (previous.error === null || previous.variables === undefined) return null;
  return previous.error instanceof ApiError &&
    previous.error.status >= 400 &&
    previous.error.status < 500
    ? null
    : previous.variables;
}
/** The controller lives above keyed consent forms so background changes cannot retarget an unknown write. */
export function useMovieRollbackCommandV1() {
  const mutation = useMutation({
    mutationFn: writeMovieRollbackV1,
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            "movie-rollback",
            input.body.scope.mediaId,
            input.body.scope.edition,
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: ["movie-target", 4, input.body.scope.mediaId],
        }),
      ]);
    },
  });
  const unknown = unresolved(mutation);
  const blocked =
    mutation.isPending ||
    mutation.isSuccess ||
    commandNeedsReview(mutation.error) ||
    unknown !== null;
  return {
    ...mutation,
    unknown,
    blocked,
    submit: (input: Submission) => {
      if (!blocked) mutation.mutate(input);
    },
    retryOriginal: () => {
      if (unknown !== null && !mutation.isPending) mutation.mutate(unknown);
    },
  };
}
export type MovieRollbackControllerV1 = ReturnType<
  typeof useMovieRollbackCommandV1
>;
