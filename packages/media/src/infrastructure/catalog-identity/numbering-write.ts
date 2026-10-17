import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { NumberingProvenanceSchema } from "#shared/acquisition/coordinates.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOperation } from "#automation/store.ts";

export async function assertNumberingOwner(
  tx: Prisma.TransactionClient,
  actorId: string,
  lock = true,
) {
  if (lock)
    await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${actorId} FOR SHARE`;
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: actorId },
  });
  requireOwner(actor);
  if (actor.restricted)
    throw new MediaError(
      "forbidden",
      "Numbering requires the current unrestricted owner",
      403,
    );
}

export async function writeNumberingMapping(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    episodeId: string;
    absoluteNumber: number | null;
    evidence: string;
    provenance?: z.infer<typeof NumberingProvenanceSchema>;
  },
) {
  const episode = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.episodeId },
  });
  const operationId = crypto.randomUUID();
  const provenance =
    input.provenance ??
    NumberingProvenanceSchema.parse({
      kind: "owner",
      operationId,
      evidenceHash: snapshotHash({
        evidence: input.evidence,
        absoluteNumber: input.absoluteNumber,
      }),
    });
  const ids = z.record(z.string(), z.json()).parse(episode.externalIds);
  delete ids["absoluteNumber"];
  if (input.absoluteNumber !== null)
    ids["absoluteNumber"] = input.absoluteNumber;
  ids["numberingEvidence"] = input.evidence;
  ids["numberingProvenance"] = provenance;
  await tx.mediaItem.update({
    where: { id: episode.id },
    data: { externalIds: ids, version: { increment: 1 } },
  });
  await tx.operation.create({
    data: {
      id: operationId,
      userId: input.actorId,
      kind: "map_episode_numbering",
      targetId: episode.id,
      status: "completed",
      payload: {
        episodeId: episode.id,
        beforeVersion: episode.version,
        absoluteNumber: input.absoluteNumber,
        provenance,
        evidence: input.evidence,
      },
    },
  });
  const intent = await tx.mediaIntent.findUnique({
    where: { mediaId: episode.id },
  });
  if (intent !== null) {
    const updated = await tx.mediaIntent.update({
      where: { mediaId: episode.id },
      data: { generation: { increment: 1 }, version: { increment: 1 } },
    });
    await queueOperation(tx, {
      key: `numbering:${operationId}`,
      kind: "reconcile_media",
      targetId: episode.id,
      payload: { mediaId: episode.id, generation: updated.generation },
    });
  }
  await tx.applicationEvent.create({
    data: {
      actorId: input.actorId,
      mediaId: episode.id,
      kind: "episode_numbering_mapped",
      payload: {
        absoluteNumber: input.absoluteNumber,
        evidence: input.evidence,
        provenance,
      },
    },
  });
}
