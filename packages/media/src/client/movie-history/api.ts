import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
  MovieHistoryCommandResultV3Schema,
  PrepareMovieHistoryV3Schema,
  type RespondMovieHistoryV3Schema,
  type ReleaseMovieHistoryV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { MovieHistoryPendingV3Schema } from "#shared/movie-editions/history-review-views-v3.ts";
import { ApiError, queryClient, readApi, writeApi } from "#client/api.ts";

export const MovieHistoryReviewV3Schema = z.union([
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
]);
export type MovieHistoryReviewV3 = z.infer<typeof MovieHistoryReviewV3Schema>;
export type MovieHistoryOwnerReviewV3 = z.infer<
  typeof MovieHistoryDetailV3Schema
>;
export type MovieHistoryPersonalReviewV3 = z.infer<
  typeof MovieHistoryPersonalDetailV3Schema
>;
export function movieHistoryReviewViewV3(review: MovieHistoryReviewV3) {
  return "schemaVersion" in review.scope
    ? {
        kind: "owner" as const,
        review: MovieHistoryDetailV3Schema.parse(review),
      }
    : {
        kind: "personal" as const,
        review: MovieHistoryPersonalDetailV3Schema.parse(review),
      };
}
export type MovieHistoryWriteV3 = {
  actorId: string;
  path: string;
  body:
    | z.infer<typeof PrepareMovieHistoryV3Schema>
    | z.infer<typeof RespondMovieHistoryV3Schema>
    | z.infer<typeof ReleaseMovieHistoryV3Schema>;
};

export function movieHistoryQueryV3(scope: MovieEditionScope) {
  return new URLSearchParams({
    mediaId: scope.mediaId,
    edition: scope.edition,
  }).toString();
}

export function readMovieHistoryContextV3(scope: MovieEditionScope) {
  return readApi(
    `/movie-history/context?${movieHistoryQueryV3(scope)}`,
    PrepareMovieHistoryV3Schema.refine(
      (value) =>
        value.scope.mediaId === scope.mediaId &&
        value.scope.edition === scope.edition,
      "Movie history context belongs to another edition",
    ),
    3,
  );
}

export function readMovieHistoryIndexV3(scope?: MovieEditionScope) {
  return readApi(
    `/movie-history/reviews${scope === undefined ? "" : `?${movieHistoryQueryV3(scope)}`}`,
    MovieHistoryPendingV3Schema.refine(
      (value) =>
        scope === undefined ||
        value.reviews.every(
          (review) =>
            review.scope.mediaId === scope.mediaId &&
            review.scope.rootMediaId === scope.rootMediaId &&
            review.scope.edition === scope.edition,
        ),
      "Pending reviews belong to another edition",
    ),
    3,
  );
}

export function readMovieHistoryReviewV3(id: string) {
  return readApi(
    `/movie-history/reviews/${encodeURIComponent(id)}`,
    MovieHistoryReviewV3Schema.refine(
      (value) => value.id === id,
      "Movie history response belongs to another review",
    ),
    3,
  );
}

export function writeMovieHistoryV3(input: MovieHistoryWriteV3) {
  return writeApi({
    ...input,
    schema: MovieHistoryCommandResultV3Schema.refine(
      (result) =>
        input.path === "/movie-history/reviews" ||
        input.path ===
          `/movie-history/reviews/${encodeURIComponent(result.recoveryReviewId)}/responses` ||
        input.path ===
          `/movie-history/reviews/${encodeURIComponent(result.recoveryReviewId)}/release`,
      "Movie history acknowledgement belongs to another review",
    ),
    version: 3,
  });
}

export function unresolvedMovieHistoryWriteV3(previous: {
  error: Error | null;
  variables: MovieHistoryWriteV3 | undefined;
}) {
  if (previous.error === null || previous.variables === undefined) return null;
  return previous.error instanceof ApiError &&
    previous.error.status >= 400 &&
    previous.error.status < 500
    ? null
    : previous.variables;
}

/** Keep this controller outside keyed consent forms: a refetch must never replace an unknown command. */
export function useMovieHistoryWriteV3() {
  const mutation = useMutation({
    mutationFn: writeMovieHistoryV3,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["movie-history"] }),
        queryClient.invalidateQueries({ queryKey: ["movie-target"] }),
        queryClient.invalidateQueries({ queryKey: ["movie-edition-context"] }),
        queryClient.invalidateQueries({ queryKey: ["movie-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["recovery"] }),
      ]);
    },
  });
  const unresolved = unresolvedMovieHistoryWriteV3(mutation);
  const needsReview =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  return {
    ...mutation,
    unresolved,
    needsReview,
    blocked: mutation.isPending || needsReview || unresolved !== null,
    submit: (input: MovieHistoryWriteV3) => {
      if (needsReview || mutation.isPending) return;
      if (unresolved !== null) return;
      mutation.mutate(input);
    },
    retryOriginal: () => {
      if (mutation.isPending) return;
      if (unresolved === null) return;
      mutation.mutate(unresolved);
    },
  };
}
export type MovieHistoryWriteControllerV3 = ReturnType<
  typeof useMovieHistoryWriteV3
>;
