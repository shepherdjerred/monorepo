import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { authorizeRequester } from "#infrastructure/requester-authorization.ts";
import type { AcquisitionIdentitySnapshot } from "#shared/acquisition/identity.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { readMovieAttemptSponsor } from "#infrastructure/movie-editions/attempt-sponsor.ts";
import type { LibraryManagementInvocation } from "./library-policy.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";

export type AcquisitionAccess = {
  libraryManagement?: LibraryManagementInvocation | undefined;
  serverMachineId?: string | undefined;
  movieAccess?: MovieChoiceAccess | undefined;
  movieScope?: MovieEditionScope | undefined;
};

function sponsorScope(
  rawScope: MovieEditionScope | undefined,
  media: { id: string; kind: string },
  sponsor: { edition: string },
  mediaIds: readonly string[],
) {
  if (rawScope === undefined) return;
  const scope = MovieEditionScopeSchema.parse(rawScope);
  if (
    media.kind !== "movie" ||
    media.id !== scope.mediaId ||
    sponsor.edition !== scope.edition ||
    mediaIds.length !== 1 ||
    mediaIds[0] !== scope.mediaId
  )
    throw new MediaError(
      "identity_scope_changed",
      "Acquisition sponsor does not belong to this movie edition",
      409,
    );
  return scope;
}

function scopedSponsor(input: {
  movieScope?: MovieEditionScope | undefined;
  mediaIds: readonly string[];
}) {
  if (input.movieScope === undefined)
    return { scope: undefined, where: effectiveRequestWhere };
  const scope = MovieEditionScopeSchema.parse(input.movieScope);
  if (input.mediaIds.length !== 1 || input.mediaIds[0] !== scope.mediaId)
    throw new MediaError(
      "identity_scope_changed",
      "Acquisition coverage differs from its movie edition scope",
      409,
    );
  return {
    scope,
    where: {
      mediaId: scope.mediaId,
      edition: scope.edition,
      active: true,
      excluded: false,
      direct: true,
    },
  };
}

export async function captureSponsorAuthority(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    sponsorRequestId: string;
    mediaIds: string[];
    serverMachineId?: string | undefined;
    movieAccess?: MovieChoiceAccess | undefined;
    movieScope?: MovieEditionScope | undefined;
  },
) {
  if (input.serverMachineId === undefined)
    throw new MediaError(
      "plex_scope_unconfigured",
      "Plex authorization is not configured",
      503,
    );
  const sponsor = await tx.mediaRequest.findUniqueOrThrow({
    where: { id: input.sponsorRequestId },
  });
  const mapping = await tx.plexIdentityMapping.findUnique({
    where: { userId: sponsor.userId },
  });
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: sponsor.mediaId },
  });
  const scope = sponsorScope(input.movieScope, media, sponsor, input.mediaIds);
  const choice =
    media.kind === "movie"
      ? await readMovieChoice(tx, {
          requestId: sponsor.id,
          access: requireMovieChoiceAccess(input.movieAccess ?? {}),
          ...(scope === undefined ? {} : { expectedScope: scope }),
        })
      : null;
  if (choice !== null && choice.status !== "authorized")
    throw new MovieChoiceProtection(
      choice.status === "protected" &&
        choice.reason === "movie_edition_choice_required"
        ? "movie_edition_choice_required"
        : "movie_edition_choice_changed",
    );
  const actorId =
    choice?.status === "authorized"
      ? choice.actor.id
      : mapping?.kind === "managed"
        ? await managedSponsorActor(tx, sponsor)
        : sponsor.userId;
  if (actorId === null)
    throw new MediaError(
      "plex_library_access_required",
      "Managed acquisition requires an authorized owner coordinator",
      403,
    );
  const authority = {
    userId: sponsor.userId,
    actorId,
    serverMachineId: input.serverMachineId,
  };
  await assertSponsorAuthority(tx, {
    authority,
    sponsorRequestId: sponsor.id,
    operationId: input.operationId,
    mediaIds: input.mediaIds,
    movieAccess: input.movieAccess,
    movieScope: input.movieScope,
  });
  return authority;
}

async function managedSponsorActor(
  tx: Prisma.TransactionClient,
  request: { id: string; userId: string; sponsorRequestId: string | null },
): Promise<string | null> {
  const sources = await tx.requestCoverage.findMany({
    where: {
      edition: "default",
      requestId: request.id,
      active: true,
      rootRequest: { ...effectiveRequestWhere },
    },
    select: { rootRequestId: true },
    take: 101,
  });
  if (sources.length > 100)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Managed request provenance exceeds the bounded scope",
      409,
    );
  const ids = [
    request.id,
    ...sources.map((row) => row.rootRequestId),
    ...(request.sponsorRequestId === null ? [] : [request.sponsorRequestId]),
  ];
  const roots = await tx.mediaRequest.findMany({
    where: {
      id: { in: ids },
      userId: request.userId,
      direct: true,
      ...effectiveRequestWhere,
    },
  });
  if (roots.length === 0) return null;
  const operations = await tx.operation.findMany({
    where: {
      kind: { in: ["reconcile_media", "restore_media", "expand_request"] },
      userId: { not: null },
      OR: roots.map((root) => ({
        targetId: root.mediaId,
        AND: [
          { payload: { path: ["requestId"], equals: root.id } },
          { payload: { path: ["requestVersion"], equals: root.version } },
        ],
      })),
    },
    take: 101,
  });
  if (operations.length > 100)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Managed request provenance exceeds the bounded scope",
      409,
    );
  const actors = [
    ...new Set(
      operations.flatMap((operation) =>
        operation.userId === null ? [] : [operation.userId],
      ),
    ),
  ];
  return actors.length === 1 ? (actors[0] ?? null) : null;
}

export async function assertLegacySubmissionSponsor(
  tx: Prisma.TransactionClient,
  attempt: {
    id: string;
    identityEvidence: unknown;
    sponsorRequestId: string | null;
    operationId: string;
    mediaIds: string[];
  },
  access?: string | AcquisitionAccess,
) {
  if (attempt.identityEvidence !== null) return;
  if (attempt.sponsorRequestId === null)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Historical acquisition has no provable requester authority",
      409,
    );
  const recorded = await readMovieAttemptSponsor(tx, { attemptId: attempt.id });
  if (recorded !== null) {
    await assertSponsorAuthority(tx, {
      authority: recorded,
      sponsorRequestId: attempt.sponsorRequestId,
      operationId: attempt.operationId,
      mediaIds: attempt.mediaIds,
      recordedAttemptId: attempt.id,
      movieAccess: typeof access === "string" ? undefined : access?.movieAccess,
      movieScope: typeof access === "string" ? undefined : access?.movieScope,
    });
    return;
  }
  await captureSponsorAuthority(tx, {
    operationId: attempt.operationId,
    sponsorRequestId: attempt.sponsorRequestId,
    mediaIds: attempt.mediaIds,
    ...(typeof access === "string" ? { serverMachineId: access } : access),
  });
}

export async function assertSponsorAuthority(
  tx: Prisma.TransactionClient,
  input: {
    authority: AcquisitionIdentitySnapshot["sponsorAuthority"];
    sponsorRequestId: string;
    operationId: string;
    mediaIds: string[];
    movieAccess?: MovieChoiceAccess | undefined;
    recordedAttemptId?: string;
    movieScope?: MovieEditionScope | undefined;
    budget?: PublicationAuthorityReadBudget;
  },
) {
  const { scope, where } = scopedSponsor(input);
  const operation = await tx.operation.findUnique({
    where: { id: input.operationId },
  });
  input.budget?.consume(operation === null ? 0 : 1);
  if (operation === null)
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Acquisition coordinator provenance is missing",
      409,
    );
  const userIds = [
    ...new Set([
      input.authority.actorId,
      input.authority.userId,
      ...(operation.userId === null ? [] : [operation.userId]),
    ]),
  ].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR SHARE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(userIds)}) ORDER BY "userId" FOR SHARE`,
  );
  const sponsor = await tx.mediaRequest.findFirst({
    where: {
      id: input.sponsorRequestId,
      userId: input.authority.userId,
      ...where,
    },
  });
  if (sponsor === null)
    throw new MediaError(
      "acquisition_sponsor_changed",
      "The acquisition sponsor no longer has an effective claim",
      409,
    );
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: input.authority.actorId },
  });
  const movieProven = await assertMovieSponsor(tx, {
    ...input,
    actorId: actor.id,
    userId: sponsor.userId,
    requestId: sponsor.id,
  });
  if (
    !movieProven &&
    actor.id !== input.authority.userId &&
    (await managedSponsorActor(tx, sponsor)) !== actor.id
  )
    throw new MediaError(
      "acquisition_sponsor_unproven",
      "Managed requester authority changed",
      409,
    );
  const owner =
    (operation.kind === "acquire_release" ||
      (scope !== undefined && operation.kind === "acquire_movie_edition_v4")) &&
    operation.userId !== null
      ? await tx.mediaUser.findUniqueOrThrow({
          where: { id: operation.userId },
        })
      : null;
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: input.mediaIds } },
  });
  if (rows.length !== input.mediaIds.length)
    throw new Error("Sponsor coverage is incomplete");
  for (const media of rows) {
    const ids = z
      .object({ plexSectionId: z.string().min(1).optional() })
      .parse(media.externalIds);
    const settings = {
      kind: media.kind,
      serverMachineId: input.authority.serverMachineId,
      ...(ids.plexSectionId === undefined
        ? {}
        : { sectionId: ids.plexSectionId }),
    };
    await authorizeRequester(tx, actor, input.authority.userId, settings);
    if (owner !== null)
      requireOwner(await authorizeRequester(tx, owner, owner.id, settings));
  }
}

async function assertMovieSponsor(
  tx: Prisma.TransactionClient,
  input: {
    authority: AcquisitionIdentitySnapshot["sponsorAuthority"];
    actorId: string;
    userId: string;
    requestId: string;
    movieAccess?: MovieChoiceAccess | undefined;
    recordedAttemptId?: string;
    movieScope?: MovieEditionScope | undefined;
    budget?: PublicationAuthorityReadBudget;
  },
) {
  const choice =
    input.movieAccess === undefined
      ? null
      : await readMovieChoice(tx, {
          requestId: input.requestId,
          access: input.movieAccess,
          ...(input.budget === undefined ? {} : { budget: input.budget }),
          ...(input.movieScope === undefined
            ? {}
            : { expectedScope: input.movieScope }),
        });
  if (
    choice !== null &&
    (choice.status !== "authorized" || choice.actor.id !== input.actorId)
  )
    throw new MovieChoiceProtection("movie_edition_choice_changed");
  const recorded =
    input.recordedAttemptId === undefined
      ? null
      : await readMovieAttemptSponsor(tx, {
          attemptId: input.recordedAttemptId,
          ...(input.budget === undefined ? {} : { budget: input.budget }),
          ...(input.movieScope === undefined
            ? {}
            : {
                expectedScope: input.movieScope,
                expectedRequestId: input.requestId,
              }),
        });
  if (
    recorded !== null &&
    (recorded.actorId !== input.actorId ||
      recorded.userId !== input.userId ||
      recorded.serverMachineId !== input.authority.serverMachineId)
  )
    throw new Error("Recorded movie sponsor differs from acquisition identity");
  return choice !== null || recorded !== null;
}
