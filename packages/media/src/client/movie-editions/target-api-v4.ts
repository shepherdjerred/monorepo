import { useMutation, useQuery } from "@tanstack/react-query";
import {
  MovieTargetContextV4Schema,
  type MovieTargetContextV4,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  MovieLifecycleCommandV4Schema,
  MovieLifecycleResultV4Schema,
  type MovieLifecycleCommandV4,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { ApiError, queryClient, readApi, writeApi } from "#client/api.ts";
import { commandNeedsReview } from "#client/target-controls/errors.tsx";
import { invalidateMovieRequests } from "./api.ts";

export function useMovieTargetV4(
  mediaId: string,
  edition: MovieEditionKey | "",
) {
  return useQuery({
    queryKey: ["movie-target", 4, mediaId, edition],
    enabled: edition !== "",
    queryFn: () => readMovieTargetV4(mediaId, edition),
    refetchInterval: 15_000,
  });
}

export function readMovieTargetV4(mediaId: string, edition: string) {
  return readApi(
    `/media/${encodeURIComponent(mediaId)}/movie-editions/${encodeURIComponent(edition)}`,
    MovieTargetContextV4Schema.refine(
      (context) =>
        context.scope.mediaId === mediaId && context.scope.edition === edition,
      "Movie controls belong to another edition",
    ),
    4,
  );
}

export function movieLifecycleCommandV4(
  context: MovieTargetContextV4,
  command: MovieLifecycleCommandV4["command"],
): MovieLifecycleCommandV4 {
  const allowed: readonly string[] =
    context.access === "detail"
      ? context.allowedActions
      : context.allowedProtectiveActions;
  if (!allowed.includes(command.action))
    throw new ApiError(
      "movie_action_unavailable",
      "Review this edition's available actions.",
      409,
    );
  return MovieLifecycleCommandV4Schema.parse({
    schemaVersion: 4,
    scope: context.scope,
    expected: context.expected,
    command,
  });
}

export function writeMovieLifecycleV4(
  actorId: string,
  input: MovieLifecycleCommandV4,
) {
  return writeApi({
    actorId,
    path: `/media/${encodeURIComponent(input.scope.mediaId)}/movie-editions/${encodeURIComponent(input.scope.edition)}/actions`,
    version: 4,
    body: input,
    schema: MovieLifecycleResultV4Schema.refine(
      (result) =>
        result.scope.mediaId === input.scope.mediaId &&
        result.scope.edition === input.scope.edition,
      "Movie action response belongs to another edition",
    ),
  });
}

export async function invalidateMovieTargetV4(mediaId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["movie-target", 4, mediaId] }),
    invalidateMovieRequests(mediaId),
  ]);
}

/** Unknown outcomes keep the original reviewed body, even if background reads change. */
export function movieLifecycleRetryV4(previous: {
  error: Error | null;
  variables: MovieLifecycleCommandV4 | undefined;
}): MovieLifecycleCommandV4 | null {
  if (previous.error === null || previous.variables === undefined) return null;
  return previous.error instanceof ApiError &&
    previous.error.status >= 400 &&
    previous.error.status < 500
    ? null
    : previous.variables;
}

export function useMovieLifecycleCommandV4(actorId: string) {
  const mutation = useMutation({
    mutationFn: (input: MovieLifecycleCommandV4) =>
      writeMovieLifecycleV4(actorId, input),
    onSuccess: (_result: unknown, input: MovieLifecycleCommandV4) =>
      invalidateMovieTargetV4(input.scope.mediaId),
  });
  const unresolved = movieLifecycleRetryV4(mutation);
  return {
    ...mutation,
    unresolved,
    blocked:
      mutation.isPending ||
      mutation.isSuccess ||
      commandNeedsReview(mutation.error) ||
      unresolved !== null,
    submit: (
      context: MovieTargetContextV4,
      command: MovieLifecycleCommandV4["command"],
    ) => {
      if (!mutation.isPending && !commandNeedsReview(mutation.error))
        mutation.mutate(
          unresolved ?? movieLifecycleCommandV4(context, command),
        );
    },
    retryOriginal: () => {
      if (unresolved !== null) mutation.mutate(unresolved);
    },
  };
}

export type MovieLifecycleControllerV4 = ReturnType<
  typeof useMovieLifecycleCommandV4
>;
