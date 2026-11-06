import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import {
  PrepareMovieHistoryV3Schema,
  MovieHistoryScopeV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import {
  MovieHistoryDiscoveryV3Schema,
  MovieHistoryPendingV3Schema,
} from "#shared/movie-editions/history-review-views-v3.ts";
import { movieDefinitionRef } from "#infrastructure/movie-editions/definition.ts";
import {
  movieChoiceSubject,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { currentMovieHistoryOwnerV3 } from "./current.ts";
import { movieHistoryConflict } from "./locks.ts";

export async function movieHistoryContextV3(
  tx: Prisma.TransactionClient,
  input: { actorId: string; scope: z.input<typeof MovieEditionScopeSchema> },
) {
  const scope = MovieEditionScopeSchema.parse(input.scope);
  await currentMovieHistoryOwnerV3(tx, input.actorId);
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
  });
  const target = await tx.mediaIntent.findUnique({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const hold = await tx.recoveryHold.findUnique({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  if (target === null || hold?.releasedAt !== null || media.kind !== "movie")
    throw movieHistoryConflict(
      "Select an existing movie cut with an unresolved household history hold",
    );
  const definition = movieDefinitionRef(scope.mediaId, scope.edition);
  return PrepareMovieHistoryV3Schema.parse({
    schemaVersion: 3,
    scope,
    expected: {
      mediaVersion: media.version,
      targetVersion: target.version,
      holdVersion: hold.version,
      definition: {
        definitionVersion: definition.definitionVersion,
        definitionDigest: definition.definitionDigest,
      },
    },
  });
}

/** Protocol, exact cut and subject are selected before the native query bound. */
export async function discoverMovieHistoryV3(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    query: z.input<typeof MovieHistoryDiscoveryV3Schema>;
    access: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const query = MovieHistoryDiscoveryV3Schema.parse(input.query);
  const user = await tx.mediaUser.findUniqueOrThrow({
    where: { id: input.actorId },
  });
  const owner = user.role === "owner" && !user.restricted;
  if (owner && query.scope === undefined)
    throw new MediaError(
      "movie_history_scope_required",
      "Select one exact movie cut to inspect pending household history",
      400,
    );
  const authority = owner
    ? null
    : await movieChoiceSubject(tx, {
        actorId: user.id,
        subjectUserId: user.id,
        purpose: "choose",
        access: input.access,
        mediaSectionId: input.access.movieSectionId,
      });
  const cut =
    query.scope === undefined
      ? Prisma.empty
      : Prisma.sql`AND r.scope->'scope' = ${JSON.stringify(query.scope)}::jsonb`;
  const subject = owner
    ? Prisma.empty
    : Prisma.sql`AND r.scope->'users' @> ${JSON.stringify([{ id: user.id }])}::jsonb`;
  const rows = z
    .array(
      z.strictObject({
        id: z.uuid(),
        version: z.int(),
        scope: z.json(),
        expiresAt: z.date(),
        responded: z.boolean(),
      }),
    )
    .parse(
      await tx.$queryRaw(Prisma.sql`
    SELECT r.id, r.version, r.scope, r."expiresAt",
      EXISTS(SELECT 1 FROM "RecoveryResponse" response WHERE response."reviewId"=r.id AND response."userId"=${user.id}) AS responded
    FROM "RecoveryReview" r
    WHERE r.scope->>'schemaVersion'='3' AND r.state='awaiting_responses' AND r."expiresAt">now()
      ${cut} ${subject}
    ORDER BY r."createdAt" DESC, r.id ASC LIMIT ${Math.min(101, budget.takeWeighted(2))}`),
    );
  // Each projection consults an immutable review and an immutable response candidate.
  budget.consume(rows.length * 2);
  if (rows.length > 100)
    throw movieHistoryConflict(
      "Pending movie history exceeds its native inventory bound",
    );
  const result = MovieHistoryPendingV3Schema.parse({
    reviews: rows.map((row) => {
      const scope = MovieHistoryScopeV3Schema.parse(row.scope);
      return {
        id: row.id,
        version: row.version,
        scope: scope.scope,
        definition: scope.definition,
        title: scope.media.title,
        expiresAt: row.expiresAt.toISOString(),
        responded: row.responded,
      };
    }),
  });
  authority?.freshness?.assertActive();
  return result;
}
