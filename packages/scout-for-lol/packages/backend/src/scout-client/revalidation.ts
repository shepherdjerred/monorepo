import type { Prisma } from "#generated/prisma/client/index.js";
import {
  ScoutClientObservationSchema,
  type ScoutClientObservation,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  readIdentityAliases,
  withRiotIdentities,
  isLcuUuid,
} from "./identity-alias.ts";
import { observationQuarantineReason } from "./ingress.ts";
import { withObserverPlatform } from "./platform-context.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";

export type RecoveryObservationRow = Prisma.ScoutClientObservationGetPayload<{
  include: { device: { select: { ownerId: true } } };
}>;

/** Recheck the existing gates; new aliases can make old evidence attributable. */
export async function revalidateClientObservation(
  row: RecoveryObservationRow,
  now: Date,
): Promise<ScoutClientObservation | null> {
  if (row.localPuuid === null) return null;
  const aliases = await readIdentityAliases(new Set([row.localPuuid]));
  const observer = aliases.get(row.localPuuid) ?? row.localPuuid;
  const riotObserver = LeaguePuuidSchema.safeParse(observer);
  if (!riotObserver.success) return null;
  const accounts = await prisma.account.findMany({
    where: {
      puuid: riotObserver.data,
      player: { discordId: row.device.ownerId },
    },
    select: { puuid: true, region: true },
  });
  if (accounts.length === 0) return null;
  const observation = withObserverPlatform(
    ScoutClientObservationSchema.parse({
      observationId: row.observationId,
      sequence: Number(row.sequence),
      capturedAt: row.capturedAt.toISOString(),
      protocolVersion: row.protocolVersion,
      schemaVersion: row.schemaVersion,
      appVersion: row.appVersion,
      kind: row.kind,
      localPuuid: observer,
      ...(row.platformId === null ? {} : { platformId: row.platformId }),
      ...(row.gameId === null ? {} : { gameId: row.gameId }),
      ...(row.lobbyId === null ? {} : { lobbyId: row.lobbyId }),
      ...(row.leaguePatch === null ? {} : { leaguePatch: row.leaguePatch }),
      payload: await withRiotIdentities(row.payload),
    }),
    accounts,
  );
  if (row.disposition === "ACCEPTED") return observation;
  const versions = await prisma.scoutClientDeviceVersion.findMany({
    where: { deviceId: row.deviceId },
    select: { appVersion: true },
  });
  const reason = observationQuarantineReason(
    observation,
    new Set(accounts.map((account) => account.puuid)),
    new Set(versions.map((version) => version.appVersion)),
    now,
  );
  if (reason !== null) return null;
  await prisma.$transaction(async (transaction) => {
    const changed = await transaction.scoutClientObservation.updateMany({
      where: { observationId: row.observationId, disposition: "QUARANTINED" },
      data: {
        disposition: "ACCEPTED",
        quarantineReason: null,
        localPuuid: observer,
        localLcuUuid:
          row.localLcuUuid ??
          (isLcuUuid(row.localPuuid ?? "") ? row.localPuuid : null),
        platformId: observation.platformId ?? null,
      },
    });
    if (changed.count === 1)
      await transaction.scoutClientObservationRevalidation.create({
        data: {
          observationId: row.observationId,
          previousReason: row.quarantineReason,
          validatedAt: now,
        },
      });
  });
  return observation;
}
