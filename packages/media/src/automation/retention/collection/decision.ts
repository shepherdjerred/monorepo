import type { Prisma } from "#generated/prisma/client.ts";
import {
  parsePlexRecord,
  readPlexPointers,
} from "#infrastructure/plex-binding/records.ts";
import { RetentionPlexProjectionV1Schema } from "#shared/plex-binding/watch.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import {
  PlexBindingScopeSchema,
  type PlexAccess,
} from "#shared/plex-binding/contract.ts";

const LIMIT = 1000;

export async function desiredCollectionMembers(
  tx: Prisma.TransactionClient,
  access: PlexAccess,
  epoch: number,
) {
  const decisions = await tx.retentionDecision.findMany({
    where: {
      state: { in: ["warning_pending", "grace_period"] },
      media: { kind: access.sectionType === "movie" ? "movie" : "episode" },
      target: { automationEpoch: epoch, availability: "available" },
    },
    orderBy: { id: "asc" },
    take: LIMIT + 1,
    select: {
      id: true,
      mediaId: true,
      edition: true,
      generation: true,
      target: { select: { generation: true, editionRootId: true } },
      plexProjection: { select: { projection: true, projectionHash: true } },
    },
  });
  if (decisions.length > LIMIT) return null;
  const current = decisions.filter(
    (row) => row.generation === row.target.generation,
  );
  if (current.length === 0) return [];
  const pointers = await readPlexPointers(
    tx,
    current.map((row) =>
      PlexBindingScopeSchema.parse({
        mediaId: row.mediaId,
        edition: MovieEditionKeySchema.parse(row.edition),
      }),
    ),
  );
  const members = new Map<string, { ratingKey: string; guid: string }>();
  for (const [index, row] of current.entries()) {
    const binding = pointers[index]?.current;
    if (binding == null || row.plexProjection === null) return null;
    const projection = parsePlexRecord(
      RetentionPlexProjectionV1Schema,
      row.plexProjection.projection,
      row.plexProjection.projectionHash,
    );
    const { association, snapshot } = binding;
    if (
      projection.decisionId !== row.id ||
      !projection.bindings.some(
        (pinned) =>
          pinned.evidenceId === snapshot.evidenceId &&
          pinned.associationHash === snapshot.associationHash &&
          pinned.revision === snapshot.revision,
      ) ||
      association.group.ownershipEpoch !== epoch ||
      association.editionRootId !== row.target.editionRootId ||
      association.access.serverMachineId !== access.serverMachineId ||
      association.access.sectionId !== access.sectionId ||
      association.access.sectionType !== access.sectionType
    )
      return null;
    const item =
      association.kind === "movie"
        ? association.item
        : association.hierarchy.show;
    const guid = item.guids.find((candidate) =>
      candidate.startsWith(`plex://${item.type}/`),
    );
    if (guid === undefined) return null;
    const prior = members.get(item.ratingKey);
    if (prior !== undefined && prior.guid !== guid) return null;
    members.set(item.ratingKey, { ratingKey: item.ratingKey, guid });
  }
  return [...members.values()];
}
