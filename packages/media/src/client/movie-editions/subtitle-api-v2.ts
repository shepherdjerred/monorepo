import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type {
  MovieManualReplacementV2Schema,
  MoviePrepareReplacementV2Schema,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { ApiError, queryClient, writeApi } from "#client/api.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { commandNeedsReview } from "#client/target-controls/errors.tsx";

export type MovieCaptionSubmissionV2 = {
  path: string;
  body:
    | z.input<typeof MovieManualReplacementV2Schema>
    | z.input<typeof MoviePrepareReplacementV2Schema>;
};

export function writeMovieCaptionV2(
  input: MovieCaptionSubmissionV2 & { actorId: string },
) {
  return writeApi({ ...input, version: 2, schema: CommandResultSchema });
}

/** A response lost after commit retains the exact reviewed file/caption versions. */
export function useMovieCaptionCommandV2(
  actorId: string,
  options?: {
    onPrepared: (reviewId: string, scope: MovieEditionScope) => void;
  },
) {
  const mutation = useMutation({
    mutationFn: writeMovieCaptionV2,
    onSuccess: (result, submitted) => {
      if ("candidateSubtitleId" in submitted.body) {
        options?.onPrepared(
          z.uuid().parse(result.subtitleReplacementId),
          submitted.body.scope,
        );
        return;
      }
      return queryClient.invalidateQueries({
        queryKey: ["movie-subtitle-target"],
      });
    },
  });
  const unknown =
    mutation.error !== null &&
    !(
      mutation.error instanceof ApiError &&
      mutation.error.status >= 400 &&
      mutation.error.status < 500
    );
  return {
    ...mutation,
    unknown,
    blocked:
      mutation.isPending ||
      mutation.isSuccess ||
      unknown ||
      commandNeedsReview(mutation.error),
    submit: (input: MovieCaptionSubmissionV2) => {
      if (!mutation.isPending && !commandNeedsReview(mutation.error))
        mutation.mutate(unknown ? mutation.variables : { ...input, actorId });
    },
    retryOriginal: () => {
      if (unknown) mutation.mutate(mutation.variables);
    },
  };
}
