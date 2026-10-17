import type { Prisma } from "#generated/prisma/client.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";

/** Media row locks serialize this read with creation/release of a reservation. */
export async function assertNoSubtitleReplacement(
  tx: Prisma.TransactionClient,
  assetIds: readonly string[],
  exceptId?: string,
) {
  const active = await tx.subtitleReplacement.findFirst({
    where: {
      assetId: { in: [...assetIds] },
      reservationActive: true,
      ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
    },
  });
  if (active !== null)
    throw new FileGuardError("subtitle_replacement_unsettled");
}

export async function lockSubtitleReplacementScope(
  tx: Prisma.TransactionClient,
  input: {
    assetId: string;
    mediaIds: readonly string[];
    replacementId?: string;
  },
) {
  await lockMedia(tx, [...input.mediaIds]);
  await lockEffectiveRequests(tx, [...input.mediaIds]);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id = 'singleton' FOR SHARE`;
  await lockSubtitlePolicies(tx);
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id = ${input.assetId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE "assetId" = ${input.assetId} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleReplacement" WHERE "assetId" = ${input.assetId} ORDER BY id FOR UPDATE`;
  await assertNoSubtitleReplacement(tx, [input.assetId], input.replacementId);
}

export async function assertReplacementOwner(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${actorId} FOR SHARE`;
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: actorId },
  });
  if (actor.role !== "owner" || actor.restricted)
    throw new MediaError(
      "forbidden",
      "Subtitle replacement requires the current unrestricted owner",
      403,
    );
  return actor;
}
