import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { readMoviePreparedRetrySourceV2 } from "#infrastructure/movie-editions/lifecycle/retry/retry-continuation-source.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MediaError } from "#application/errors.ts";
import { readPlexPhysicalGroup } from "#infrastructure/plex-binding/read.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";

/** Only for reservation-absent admission after the caller's real current CAS and exact scope lock. */
export async function readCompletedMovieRetryAdmissionV1(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    mode: "manual" | "automatic";
    access: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const pointer = await readPlexPointer(
    tx,
    { mediaId: input.scope.mediaId, edition: input.scope.edition },
    budget,
  );
  if (pointer.current?.association.schemaVersion !== 2)
    throw new MediaError(
      "movie_retry_attempt_required",
      "Movie retry has no exact completed acquisition parent",
      409,
    );
  const binding = pointer.current.snapshot;
  const { asset, group } = await readPlexPhysicalGroup(
    tx,
    pointer.current.association.group.assetId,
  );
  if (
    asset.state !== "published" ||
    identityHash(group) !== identityHash(pointer.current.association.group) ||
    pointer.current.association.access.serverMachineId !==
      input.access.serverMachineId ||
    pointer.current.association.access.sectionId !== input.access.movieSectionId
  )
    throw new MediaError(
      "movie_retry_attempt_required",
      "Completed movie retry has no exact current physical serving authority",
      409,
    );
  const parents = await tx.operation.findMany({
    where: {
      kind: { in: ["reconcile_movie_edition_v4", "acquire_movie_edition_v4"] },
      targetId: input.scope.mediaId,
      OR: ["moviePlexReceiptV2", "moviePlexReceiptV3"].map((marker) => ({
        result: {
          path: [marker, "receipt", "binding", "evidenceId"],
          equals: binding.evidenceId,
        },
      })),
    },
    take: 2,
  });
  budget.consume(parents.length);
  if (parents.length === 0)
    throw new MediaError(
      "movie_retry_attempt_required",
      "Current serving authority is not a completed movie acquisition",
      409,
    );
  if (parents.length !== 1)
    throw new Error("Completed movie retry parent is ambiguous");
  const command = parents[0];
  if (command === undefined)
    throw new Error("Completed movie retry parent disappeared");
  const marker = z
    .object({
      moviePlexReceiptV2: z.unknown().optional(),
      moviePlexReceiptV3: z.unknown().optional(),
    })
    .parse(command.result);
  if (
    marker.moviePlexReceiptV2 !== undefined &&
    marker.moviePlexReceiptV3 !== undefined
  )
    throw new Error(
      "Completed movie retry has competing literal Plex receipt identities",
    );
  const selected =
    marker.moviePlexReceiptV2 === undefined
      ? marker.moviePlexReceiptV3
      : marker.moviePlexReceiptV2;
  const raw = z
    .object({
      receipt: z.object({
        input: MovieAttemptOperationV4Schema,
        binding: z.json(),
      }),
    })
    .parse(selected);
  if (
    identityHash(raw.receipt.binding) !== identityHash(binding) ||
    identityHash(raw.receipt.input.scope) !== identityHash(input.scope)
  )
    throw new Error(
      "Completed movie retry parent differs from its actual scoped serving pointer",
    );
  const original = await readMoviePreparedRetrySourceV2(
    tx,
    { ...input, attemptId: raw.receipt.input.attemptId },
    budget,
  );
  if (
    original.kind !== "plex_committed" ||
    original.source.attempt.state !== "completed"
  )
    throw new Error(
      "Reservation-absent movie retry did not resolve genuine completed history",
    );
  // Admission still separately requires current original personal choice (or current owner approval),
  // same profile/generation/epoch and current configured access. It creates no reservation or attempt.
  return original;
}
