import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export function movieRetentionInclude(scope: MovieEditionScope) {
  return {
    intents: { where: { edition: scope.edition } },
    holds: { where: { edition: scope.edition } },
    watchStates: { where: { edition: scope.edition } },
    requests: {
      where: {
        edition: scope.edition,
        active: true,
        excluded: false,
        direct: true,
      },
      include: { user: { include: { notificationPreference: true } } },
    },
    assets: {
      where: { edition: scope.edition, current: true },
      include: { asset: true },
    },
  } satisfies Prisma.MediaItemInclude;
}

/** The exact durable command is independent of every other movie edition's generation. */
export async function readMovieRetentionCommand(
  tx: Prisma.TransactionClient,
  input: MovieOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const payload = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.literal("retain_movie_edition_v4"),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== payload.kind ||
    operation.targetId !== input.scope.mediaId ||
    identityHash(
      MovieOperationV4Schema.parse({
        schemaVersion: payload.schemaVersion,
        operationId: payload.operationId,
        mediaId: payload.mediaId,
        generation: payload.generation,
        scope: payload.scope,
      }),
    ) !== identityHash(input)
  )
    throw new Error("Movie retention command differs from its durable scope");
  return { operation, epoch: payload.recoveryEpoch };
}

export async function readMovieRetentionItem(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
) {
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
    include: movieRetentionInclude(scope),
  });
  const target = media.intents[0];
  if (
    media.kind !== "movie" ||
    scope.rootMediaId !== media.id ||
    media.intents.length !== 1 ||
    target?.editionRootId !== scope.rootMediaId ||
    media.assets.length !== 1 ||
    media.assets.some(
      ({ asset }) =>
        asset.edition !== scope.edition ||
        asset.editionRootId !== scope.rootMediaId,
    )
  )
    throw new PlexBindingProtection("ownership_changed");
  return { media, target };
}
