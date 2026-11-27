import { vi } from "vitest";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/** A Scout player in a server with one tracked account per PUUID. */
export async function seedConsumerPlayer(
  prisma: ExtendedPrismaClient,
  creator: DiscordAccountId,
  options: {
    serverId: DiscordGuildId;
    alias: string;
    discordId?: DiscordAccountId;
    puuids: LeaguePuuid[];
    lastMatchTime?: Date | null;
  },
) {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias: options.alias,
      ...(options.discordId === undefined
        ? {}
        : { discordId: options.discordId }),
      serverId: options.serverId,
      creatorDiscordId: creator,
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.account.createMany({
    data: options.puuids.map((puuid, index) => ({
      alias: `${options.alias}-${index.toString()}`,
      puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: options.serverId,
      creatorDiscordId: creator,
      riotGameName: `${options.alias} Riot ${index.toString()}`,
      riotTagLine: "NA1",
      riotIdUpdatedAt: now,
      lastMatchTime:
        options.lastMatchTime === undefined ? now : options.lastMatchTime,
      lastCheckedAt: now,
      createdTime: now,
      updatedTime: now,
    })),
  });
  return player;
}

/**
 * The module replacement for `#src/report-lake/receipted-archive.ts`: the
 * live view reads each captured game's roster from its archived spectator
 * snapshot, and the object store is not part of the consumer player suites.
 * Use from a `vi.mock` factory with a `vi.hoisted` map of snapshots by match
 * id.
 */
export async function stubArchivedPrematchSnapshots(
  snapshots: ReadonlyMap<string, object>,
) {
  const actual: object = await vi.importActual(
    "#src/report-lake/receipted-archive.ts",
  );
  return {
    ...actual,
    readArchivedPrematchSnapshot: (
      _descriptor: unknown,
      matchId: RiotMatchId,
    ) => {
      const snapshot = snapshots.get(matchId);
      if (snapshot === undefined) {
        throw new Error(`No archived snapshot stubbed for ${matchId}`);
      }
      return Promise.resolve(snapshot);
    },
  };
}
