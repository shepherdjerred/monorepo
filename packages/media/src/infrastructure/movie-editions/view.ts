import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import {
  MovieEditionContextV3Schema,
  MovieEditionRequestListV3Schema,
} from "#shared/movie-editions/view.ts";
import {
  MOVIE_EDITION_REGISTRY,
  MovieEditionKeySchema,
  movieEditionDisplayLabel,
} from "#shared/movie-editions/registry.ts";
import type { MovieEditionReason } from "#shared/movie-editions/fulfillment.ts";
import {
  movieChoiceSubject,
  lockMovieChoiceIdentities,
  type MovieChoiceAccess,
} from "./access.ts";
import { matchesMovieDefinition, movieDefinitionRef } from "./definition.ts";
import { readMovieRequestFulfillment } from "./fulfillment.ts";

export async function readMovieEditionContext(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: {
    mediaId: string;
    subjectUserId: string;
    access: MovieChoiceAccess;
  },
) {
  const subject = await movieChoiceSubject(tx, {
    actorId: actor.id,
    subjectUserId: input.subjectUserId,
    access: input.access,
    purpose: "choose",
  });
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.mediaId },
  });
  if (media.kind !== "movie")
    throw new MediaError(
      "movie_scope_required",
      "Edition choice is for movies",
      422,
    );
  if (!canReadMovie(subject, media.externalIds, input.access))
    throw new MediaError(
      "plex_library_access_required",
      "This movie is outside the profile's library scope",
      403,
    );
  const definitions = await tx.mediaEditionDefinition.findMany({
    where: { rootMediaId: media.id },
  });
  const targets = await tx.mediaIntent.findMany({
    where: { mediaId: media.id },
  });
  const requests = await tx.mediaRequest.findMany({
    where: { mediaId: media.id, userId: input.subjectUserId },
  });
  const options = Object.keys(MOVIE_EDITION_REGISTRY).map((key) => {
    const edition = MovieEditionKeySchema.parse(key);
    const proposed = movieDefinitionRef(media.id, edition);
    const stored = definitions.find((row) => row.key === edition);
    const target = targets.find((row) => row.edition === edition);
    const request = requests.find((row) => row.edition === edition);
    const reasons: MovieEditionReason[] = [];
    if (
      stored !== undefined &&
      !matchesMovieDefinition(stored, proposed.definition)
    )
      reasons.push("edition_definition_conflict");
    if (target !== undefined && target.editionRootId !== media.id)
      reasons.push("lineage_unresolved");
    if (edition !== "default") reasons.push("edition_acquisition_not_ready");
    return {
      edition,
      definitionVersion: proposed.definitionVersion,
      definitionDigest: proposed.definitionDigest,
      displayLabel: movieEditionDisplayLabel(edition),
      policy: proposed.definition.policy,
      storedDefinition:
        stored === undefined
          ? null
          : {
              definitionVersion: stored.definitionVersion,
              definitionDigest: matchesMovieDefinition(
                stored,
                proposed.definition,
              )
                ? proposed.definitionDigest
                : definitionDigest(stored),
            },
      targetVersion: target?.version ?? null,
      request:
        request === undefined
          ? null
          : {
              id: request.id,
              version: request.version,
              choiceRevision: request.movieEditionChoiceRevision,
              choiceId: request.movieEditionChoiceId,
            },
      acquisition: reasons.length === 0 ? "eligible" : "protected",
      reasons,
    };
  });
  return MovieEditionContextV3Schema.parse({
    schemaVersion: 3,
    mediaId: media.id,
    subjectUserId: input.subjectUserId,
    access: "detail",
    mediaVersion: media.version,
    registryVersion: 1,
    options,
    pendingDemands: requests
      .filter(
        (row) =>
          row.active && !row.excluded && row.movieEditionChoiceId === null,
      )
      .map((row) => ({
        requestId: row.id,
        reason: "movie_edition_choice_required",
        choiceId: null,
        fulfillment: "pending_choice",
      })),
  });
}

export async function readMovieEditionRequests(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: {
    subjectUserId: string;
    cursor: string | null;
    access: MovieChoiceAccess;
  },
) {
  const subject = await movieChoiceSubject(tx, {
    actorId: actor.id,
    subjectUserId: input.subjectUserId,
    access: input.access,
    purpose: "protect",
  });
  const rows = await tx.mediaRequest.findMany({
    where: {
      userId: input.subjectUserId,
      media: { kind: "movie" },
      ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
    },
    include: { media: true, target: true },
    orderBy: { id: "asc" },
    take: 51,
  });
  const selected = rows.slice(0, 50);
  await lockMovieChoiceIdentities(tx, {
    mediaIds: selected.map((row) => row.mediaId),
    extraUserIds: [actor.id, subject.subject.id],
  });
  const items = [];
  for (const row of selected) {
    const current = await tx.assetCoverage.findMany({
      where: { mediaId: row.mediaId, edition: row.edition, current: true },
      include: { asset: true },
      take: 2,
    });
    if (current.length > 1)
      throw new Error("Movie target has multiple current assets");
    const asset = current[0]?.asset;
    const fulfillment = await readMovieRequestFulfillment(tx, {
      requestId: row.id,
      currentAsset:
        asset === undefined
          ? null
          : { assetId: asset.id, assetVersion: asset.version },
      access: input.access,
    });
    const common = {
      requestId: row.id,
      scope: {
        rootMediaId: row.mediaId,
        mediaId: row.mediaId,
        edition: row.edition,
      },
      active: row.active && !row.excluded,
      targetVersion: row.target.version,
      requestVersion: row.version,
      choiceRevision: row.movieEditionChoiceRevision,
      choiceId: row.movieEditionChoiceId,
      fulfillment,
      canCancel: row.active && !row.excluded,
      canRevokeChoice:
        row.active && !row.excluded && row.movieEditionChoiceId !== null,
    };
    items.push(
      canReadMovie(subject, row.media.externalIds, input.access)
        ? {
            ...common,
            access: "detail",
            title: row.media.title,
            year: row.media.year,
            editionLabel: movieEditionDisplayLabel(
              MovieEditionKeySchema.parse(row.edition),
            ),
          }
        : { ...common, access: "protection_only" },
    );
  }
  return MovieEditionRequestListV3Schema.parse({
    schemaVersion: 3,
    subjectUserId: input.subjectUserId,
    items,
    nextCursor: rows.length > 50 ? (selected.at(-1)?.id ?? null) : null,
  });
}

function canReadMovie(
  subject: Awaited<ReturnType<typeof movieChoiceSubject>>,
  externalIds: unknown,
  access: MovieChoiceAccess,
): boolean {
  const { plexSectionId } = z
    .object({ plexSectionId: z.string().optional() })
    .parse(externalIds);
  const mapping = subject.mapping;
  const now = Date.now();
  return (
    mapping !== null &&
    mapping.serverMachineId === access.serverMachineId &&
    mapping.verifiedAt !== null &&
    (subject.actor.id !== subject.subject.id || !mapping.plexRestricted) &&
    mapping.verifiedAt.getTime() <= now &&
    now - mapping.verifiedAt.getTime() <= 300_000 &&
    mapping.permittedMediaKinds.includes("movie") &&
    mapping.permittedSectionIds.includes(plexSectionId ?? access.movieSectionId)
  );
}

import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
function definitionDigest(row: {
  rootMediaId: string;
  key: string;
  policy: string;
  pathLabel: string;
  plexLabel: string;
  definitionVersion: number;
}) {
  return identityHash({
    rootMediaId: row.rootMediaId,
    key: row.key,
    policy: row.policy,
    pathLabel: row.pathLabel,
    plexLabel: row.plexLabel,
    definitionVersion: row.definitionVersion,
  });
}
