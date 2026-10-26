import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaItem } from "#generated/prisma/client.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { MediaDetailSchema } from "#shared/api.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { defaultIntent } from "#shared/editions/scope.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import {
  currentSubtitlePolicies,
  policyStatus,
} from "#infrastructure/subtitle-policy.ts";
import {
  visibilityReader,
  visibilityAncestry,
  publicAssetProperties,
  scopedRemovalConfirmation,
  type VisibilitySections,
} from "./access.ts";
import { mediaVisibility } from "./detail.ts";

/** Existing detail transaction; configuration was captured before entering PG. */
export function readMediaDetail(
  db: Database,
  input: {
    actor: MediaActor;
    mediaId: string;
    expectedKind: MediaItem["kind"] | undefined;
    plexAccess: PlexAccess | null;
    sections: VisibilitySections | undefined;
    movieChoiceAccess: MovieChoiceAccess | undefined;
    serverMachineId: string | undefined;
    movieSectionId: string | undefined;
  },
) {
  const { actor, mediaId, plexAccess, movieChoiceAccess } = input;
  return db.$transaction(async (tx) => {
    const reader = await visibilityReader(tx, actor, {
      serverMachineId: input.serverMachineId,
      sections:
        plexAccess === null
          ? input.sections
          : {
              ...input.sections,
              [plexAccess.sectionType === "movie" ? "movie" : "series"]:
                plexAccess.sectionId,
            },
    });
    const item = await tx.mediaItem.findUnique({
      where: { id: mediaId },
      include: {
        ...visibilityAncestry,
        children: {
          include: visibilityAncestry,
          orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
          take: 1000,
        },
        intents: { where: { edition: "default" } },
        requests: {
          where: {
            ...effectiveRequestWhere,
            ...(reader.owner ? {} : { userId: actor.id }),
          },
          select: {
            id: true,
            userId: true,
            subtitleLanguages: true,
            version: true,
            user: { select: { displayName: true } },
          },
        },
        holds: {
          where: {
            edition: "default",
            ...(reader.owner ? {} : { userId: actor.id }),
          },
          select: { id: true, userId: true, until: true, isPin: true },
        },
        retention: {
          where: {
            edition: "default",
            state: { notIn: ["cancelled", "purged"] },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            state: true,
            graceUntil: true,
            purgeAfter: true,
            version: true,
          },
        },
        watchStates: {
          where: {
            edition: "default",
            ...(reader.owner ? {} : { userId: actor.id }),
          },
          select: { userId: true, watched: true, observedAt: true },
        },
        assets: {
          where: { edition: "default", asset: { edition: "default" } },
          select: {
            current: true,
            edition: true,
            asset: {
              select: {
                id: true,
                checksum: true,
                version: true,
                owned: true,
                ownershipEpoch: true,
                properties: true,
                state: true,
                createdAt: true,
                subtitles: true,
              },
            },
          },
        },
      },
    });
    if (!item)
      throw new MediaError("media_not_found", "Media item does not exist", 404);
    if (plexAccess === null || item.kind !== input.expectedKind)
      throw new MediaError(
        "version_conflict",
        "The title changed; refresh its details",
        409,
      );
    if (!reader.visible(item))
      throw new MediaError(
        "plex_library_access_required",
        "This title is outside your current library access",
        403,
      );
    const events = await tx.applicationEvent.findMany({
      where: {
        mediaId,
        ...(reader.owner
          ? {}
          : { OR: [{ actorId: actor.id }, { actorId: null }] }),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, kind: true, createdAt: true },
    });
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const policies = await currentSubtitlePolicies(tx, [mediaId]);
    return MediaDetailSchema.parse({
      ...item,
      intent: defaultIntent(item.intents),
      children: item.children.filter((child) => reader.visible(child)),
      visibility: await mediaVisibility(tx, {
        media: item,
        userId: actor.id,
        owner: reader.owner,
        epoch: runtime.recoveryEpoch,
        serverMachineId: input.serverMachineId,
        movieSectionId: input.movieSectionId,
        movieChoiceAccess,
        plexAccess,
        visible: reader.visible,
      }),
      subtitlePolicies: policies,
      assets: item.assets.map((coverage) => ({
        ...coverage,
        asset: {
          ...coverage.asset,
          properties: publicAssetProperties(coverage.asset.properties),
          subtitleStatus: policyStatus({
            policy: policies[0],
            asset: coverage.asset,
            epoch: runtime.recoveryEpoch,
          }),
          subtitles: coverage.asset.subtitles.map((subtitle) => ({
            ...subtitle,
            accepted: subtitleAccepted({
              subtitle,
              asset: coverage.asset,
              epoch: runtime.recoveryEpoch,
            }),
          })),
        },
      })),
      events,
      ...(reader.owner
        ? await scopedRemovalConfirmation(tx, mediaId, reader.visible)
        : {}),
    });
  });
}
