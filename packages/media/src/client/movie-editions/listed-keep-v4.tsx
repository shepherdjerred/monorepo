import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieLifecycleCommandV4 } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { ApiError } from "#client/api.ts";
import { CommandError } from "#client/target-controls/errors.tsx";
import {
  invalidateMovieTargetV4,
  movieLifecycleCommandV4,
  readMovieTargetV4,
  writeMovieLifecycleV4,
} from "./target-api-v4.ts";

export function MovieListedKeepV4({
  actorId,
  scope,
}: {
  actorId: string;
  scope: MovieEditionScope;
}) {
  const pending = useRef<MovieLifecycleCommandV4 | null>(null);
  const keep = useMutation({
    mutationFn: async () => {
      const input =
        pending.current ??
        movieLifecycleCommandV4(
          await readMovieTargetV4(scope.mediaId, scope.edition),
          { action: "keep" },
        );
      pending.current = input;
      return writeMovieLifecycleV4(actorId, input);
    },
    onSuccess: async () => {
      pending.current = null;
      await invalidateMovieTargetV4(scope.mediaId);
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
        className="button subtle"
        disabled={
          keep.isPending ||
          keep.isSuccess ||
          (keep.error instanceof ApiError && keep.error.status === 409)
        }
        onClick={() => {
          keep.mutate();
        }}
      >
        {keep.isPending
          ? "Keeping edition…"
          : pending.current === null
            ? "Keep this edition"
            : "Retry original Keep"}
      </button>
      <CommandError
        error={keep.error}
        review={() => {
          pending.current = null;
          keep.reset();
          void invalidateMovieTargetV4(scope.mediaId);
        }}
      />
      {keep.isSuccess && <p role="status">This edition is protected.</p>}
    </>
  );
}
