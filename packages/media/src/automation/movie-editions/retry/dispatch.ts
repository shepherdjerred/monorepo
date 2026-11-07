import { z } from "zod";
import type { Operation } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { MovieRetryCaptureV1Schema } from "#shared/movie-editions/retry/v1.ts";
import {
  MovieRetryCaptureV2Schema,
  MovieRetryPlexCaptureV1Schema,
} from "#shared/movie-editions/retry/v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MediaError } from "#application/errors.ts";
import { reconcileMovieRetryV4 } from "./recovery.ts";
import { reconcileMovieContinuationV2 } from "./continuation.ts";
import { reconcileCommittedMovieRetryV1 } from "./plex-acknowledgement.ts";

export function readMovieRetryDispatchV4(
  operation: Operation,
  input: MovieOperationV4,
) {
  const raw = z
    .object({
      movieRetryV1: z.unknown().optional(),
      movieRetryV2: z.unknown().optional(),
      movieRetryPlexAckV1: z.unknown().optional(),
    })
    .parse(operation.payload);
  const count = Object.values(raw).filter(
    (value) => value !== undefined,
  ).length;
  if (count === 0) return null;
  if (count !== 1)
    throw new Error("Movie retry command has competing protocol identities");
  const selected = selectedRetry(raw);
  const stored = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.string(),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  const command = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(stored),
  );
  if (
    operation.id !== stored.operationId ||
    operation.kind !== "reconcile_movie_edition_v4" ||
    operation.kind !== stored.kind ||
    operation.targetId !== stored.mediaId ||
    selected.capture.generation !== stored.generation ||
    selected.capture.recoveryEpoch !== stored.recoveryEpoch
  )
    throw new Error(
      "Movie retry command changed its actual persisted coordinator selection",
    );
  if (identityHash(command) !== identityHash(input))
    throw new MediaError(
      "identity_scope_changed",
      "Movie retry input differs from its actual recorded coordinator",
      409,
    );
  return selected;
}

function selectedRetry(raw: {
  movieRetryV1?: unknown;
  movieRetryV2?: unknown;
  movieRetryPlexAckV1?: unknown;
}) {
  if (raw.movieRetryV1 !== undefined)
    return {
      kind: "initial" as const,
      capture: MovieRetryCaptureV1Schema.parse(raw.movieRetryV1),
    };
  if (raw.movieRetryV2 !== undefined)
    return {
      kind: "continuation" as const,
      capture: MovieRetryCaptureV2Schema.parse(raw.movieRetryV2),
    };
  return {
    kind: "plex_committed" as const,
    capture: MovieRetryPlexCaptureV1Schema.parse(raw.movieRetryPlexAckV1),
  };
}

export function dispatchMovieRetryV4(
  context: MediaAutomationContext,
  input: {
    command: MovieOperationV4;
    operation: Operation;
    selected: NonNullable<ReturnType<typeof readMovieRetryDispatchV4>>;
  },
) {
  switch (input.selected.kind) {
    case "initial":
      return reconcileMovieRetryV4(context, {
        ...input,
        capture: input.selected.capture,
      });
    case "continuation":
      return reconcileMovieContinuationV2(context, {
        ...input,
        capture: input.selected.capture,
      });
    case "plex_committed":
      return reconcileCommittedMovieRetryV1(context, {
        ...input,
        capture: input.selected.capture,
      });
  }
}
