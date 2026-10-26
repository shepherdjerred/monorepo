import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockMovieChoiceIdentities } from "#infrastructure/movie-editions/access.ts";
import { assertRuntime, lockMedia } from "#automation/files/guards.ts";
import type { RemovalEntry, Transaction } from "#automation/files/types.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import {
  assertQuarantinedPlexWatchScope,
  type QuarantinedPlexWatchScope,
} from "#infrastructure/plex-binding/quarantine.ts";

/** Full manifest closure precedes every row that can authorize a physical effect. */
export async function lockRemovalAuthority(
  tx: Transaction,
  input: {
    plan: readonly RemovalEntry[];
    epoch: number;
    access: readonly PlexAccess[];
    evidence: unknown;
    quarantinedScopes?: readonly QuarantinedPlexWatchScope[];
  },
) {
  const quarantined = input.quarantinedScopes ?? [];
  const mediaIds = [
    ...new Set([
      ...input.plan.flatMap((entry) => entry.mediaIds),
      ...quarantined.flatMap((scope) => scope.mediaIds),
    ]),
  ].sort();
  const assetIds = [
    ...new Set([
      ...input.plan.map((entry) => entry.assetId),
      ...quarantined.flatMap((scope) => scope.assetIds),
    ]),
  ].sort();
  const owner = z
    .object({ ownerOverride: z.object({ ownerId: z.string() }).optional() })
    .parse(input.evidence).ownerOverride;
  await lockMedia(tx, mediaIds);
  await lockEffectiveRequests(tx, mediaIds);
  await assertRuntime(tx, input.epoch);
  await lockMovieChoiceIdentities(tx, {
    mediaIds,
    extraUserIds: owner === undefined ? [] : [owner.ownerId],
  });
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(assetIds)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(assetIds)}) ORDER BY "assetId","mediaId" FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "SubtitleAsset" WHERE "assetId" IN (${Prisma.join(assetIds)}) ORDER BY id FOR UPDATE`,
  );
  const continuationIds = [
    ...new Set(quarantined.flatMap((scope) => scope.continuationIds)),
  ].sort();
  if (continuationIds.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "NativeQuarantineContinuation" WHERE id IN (${Prisma.join(continuationIds)}) ORDER BY id FOR UPDATE`,
    );
  for (const server of [
    ...new Set(input.access.map((value) => value.serverMachineId)),
  ].sort())
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + server},0))::text`;
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "WatchObservationFence" WHERE "mediaId" IN (${Prisma.join(mediaIds)}) AND edition='default' ORDER BY "mediaId" FOR UPDATE`,
  );
  for (const scope of quarantined)
    await assertQuarantinedPlexWatchScope(tx, scope);
}
