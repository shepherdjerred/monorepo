import { MediaError } from "#application/errors.ts";
import type { MediaItem, LibraryAsset } from "#generated/prisma/client.ts";
import type { PlexItem } from "#integrations/plex.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type {
  PlexAssociationV1,
  PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import {
  projectItem,
  associationHash,
} from "#automation/publication/association/projection.ts";
import { readHierarchy } from "#automation/publication/association/hierarchy.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import { publicationAwait } from "#automation/publication/execution.ts";

type CompensatedPlexItemInput = {
  media: MediaItem;
  asset: LibraryAsset;
  item: PlexItem;
  sectionId: string;
  association: PlexAssociationV1;
  freshness: PlexBindingFreshness;
};

export async function verifyCompensatedPlexItem(
  context: MediaAutomationContext,
  input: CompensatedPlexItemInput,
  execution: NativeCompensationExecutionContext,
) {
  const { media, asset, sectionId } = input;
  const server = z.string().min(1).parse(context.serverMachineId);
  const checksum = z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .parse(asset.checksum);
  const metadata = await publicationAwait(execution, () =>
    context.plex.metadata(input.item.ratingKey, execution.signal),
  );
  const seriesKey = metadata.grandparentRatingKey;
  const series =
    seriesKey === undefined
      ? undefined
      : await publicationAwait(execution, () =>
          context.plex.metadata(seriesKey, execution.signal),
        );
  const parts = metadata.Media?.flatMap((item) => item.Part) ?? [];
  const projection = projectItem(metadata);
  const cache = new Map([[metadata.ratingKey, metadata]]);
  if (series !== undefined) cache.set(series.ratingKey, series);
  const hierarchy =
    input.association.kind === "episode"
      ? await readHierarchy(
          {
            plex: context.plex,
            freshness: input.freshness,
            execution: {
              ...execution,
              checkpoint: () => execution.checkpoint("publication"),
            },
          },
          metadata,
          cache,
        )
      : null;
  input.freshness.assertActive();
  assertCompensatedIdentity(input, { projection, hierarchy, parts, server });
  return {
    mediaId: media.id,
    assetId: asset.id,
    assetVersion: asset.version,
    checksum,
    canonicalPath: asset.path,
    sectionId,
    ratingKey: metadata.ratingKey,
    identityHash: snapshotHash({
      server,
      sectionId,
      mediaId: media.id,
      path: asset.path,
      ratingKey: metadata.ratingKey,
      guids: metadata.Guid ?? [],
      seriesGuids: series?.Guid ?? [],
      season: metadata.parentIndex ?? null,
      episode: metadata.index ?? null,
    }),
  };
}

function assertCompensatedIdentity(
  input: CompensatedPlexItemInput,
  observed: {
    projection: ReturnType<typeof projectItem>;
    hierarchy: Awaited<ReturnType<typeof readHierarchy>> | null;
    parts: NonNullable<PlexItem["Media"]>[number]["Part"];
    server: string;
  },
) {
  const { media, asset, sectionId } = input;
  const { projection, hierarchy, parts, server } = observed;
  if (
    associationHash({
      ratingKey: projection.ratingKey,
      type: projection.type,
      guids: projection.guids,
      media: projection.media,
    }) !== associationHash(input.association.item) ||
    (input.association.kind === "episode" &&
      associationHash(hierarchy) !==
        associationHash(input.association.hierarchy)) ||
    input.association.scope.mediaId !== media.id ||
    input.association.group.assetId !== asset.id ||
    input.association.group.assetVersion !== asset.version ||
    input.association.access.sectionId !== sectionId ||
    input.association.access.serverMachineId !== server ||
    parts.length !== 1 ||
    parts[0]?.file !== asset.path ||
    (parts[0].size !== undefined &&
      String(parts[0].size) !== String(asset.sizeBytes))
  )
    throw new MediaError(
      "compensation_plex_identity_unproved",
      "Plex has not verified the exact restored file and coverage",
      409,
    );
}
