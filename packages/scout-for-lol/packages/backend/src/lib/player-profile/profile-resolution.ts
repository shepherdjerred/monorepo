import {
  RankSchema,
  type DiscordGuildId,
  type PlayerId,
  type Rank,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { getPlayerOrThrow, notFound } from "#src/lib/player-admin/shared.ts";

export type ProfileAccount = {
  puuid: string;
  region: string;
  riotGameName: string | null;
  riotTagLine: string | null;
  riotIdUpdatedAt: Date | null;
  lastMatchTime: Date | null;
  lastCheckedAt: Date | null;
};

export type ResolvedPlayerProfile = {
  playerId: number;
  alias: string;
  puuids: string[];
  accounts: ProfileAccount[];
};

export type ResolvedGuildPlayerProfile = ResolvedPlayerProfile & {
  discordId: string | null;
};

function profileAccount(account: ProfileAccount): ProfileAccount {
  return {
    puuid: account.puuid,
    region: account.region,
    riotGameName: account.riotGameName,
    riotTagLine: account.riotTagLine,
    riotIdUpdatedAt: account.riotIdUpdatedAt,
    lastMatchTime: account.lastMatchTime,
    lastCheckedAt: account.lastCheckedAt,
  };
}

export async function resolveGuildPuuids(input: {
  guildId: string;
  alias: string;
}): Promise<ResolvedGuildPlayerProfile> {
  const player = await getPlayerOrThrow(input);
  return {
    playerId: player.id,
    alias: player.alias,
    discordId: player.discordId,
    puuids: player.accounts.map((account) => account.puuid),
    accounts: player.accounts.map((account) => profileAccount(account)),
  };
}

export async function resolveConsumerPlayerPuuids(input: {
  playerId: PlayerId;
  guildIds: DiscordGuildId[];
}): Promise<ResolvedPlayerProfile & { guildId: string }> {
  const player = await prisma.player.findFirst({
    where: { id: input.playerId, serverId: { in: input.guildIds } },
    include: { accounts: true },
  });
  if (player === null) {
    throw notFound("Player was not found");
  }
  return {
    playerId: player.id,
    alias: player.alias,
    guildId: player.serverId,
    puuids: player.accounts.map((account) => account.puuid),
    accounts: player.accounts.map((account) => profileAccount(account)),
  };
}

export function parseRank(serialized: string | null): Rank | undefined {
  if (serialized === null) return undefined;
  const parsed = RankSchema.safeParse(JSON.parse(serialized));
  return parsed.success ? parsed.data : undefined;
}

/** Latest known rank per queue, newest game first. */
export async function latestRanks(puuids: string[]): Promise<{
  solo: Rank | undefined;
  flex: Rank | undefined;
  ranked5s: Rank | undefined;
}> {
  const [rankHistory, current] = await Promise.all([
    Promise.all(
      (["solo", "flex", "ranked 5s"] as const).map(async (queueType) =>
        prisma.matchRankHistory.findFirst({
          where: {
            puuid: { in: puuids },
            queueType,
            rankAfter: { not: null },
          },
          orderBy: [
            { matchGameEndAt: { sort: "desc", nulls: "last" } },
            { capturedAt: "desc" },
          ],
        }),
      ),
    ),
    prisma.currentRankSnapshot.findMany({
      where: { puuid: { in: puuids } },
      orderBy: { fetchedAt: "desc" },
    }),
  ]);

  function newestRank(
    live: (typeof rankHistory)[number] | undefined,
    queueType: "solo" | "flex" | "ranked 5s",
  ): Rank | undefined {
    const snapshot = current.find((entry) => {
      if (queueType === "solo") return entry.soloRank !== null;
      if (queueType === "flex") return entry.flexRank !== null;
      return entry.ranked5sRank !== null;
    });
    const snapshotValue =
      queueType === "solo"
        ? snapshot?.soloRank
        : queueType === "flex"
          ? snapshot?.flexRank
          : snapshot?.ranked5sRank;
    if (
      snapshot !== undefined &&
      (live == null || snapshot.fetchedAt > live.capturedAt)
    ) {
      return parseRank(snapshotValue ?? null);
    }
    return parseRank(live?.rankAfter ?? null);
  }

  return {
    solo: newestRank(rankHistory[0], "solo"),
    flex: newestRank(rankHistory[1], "flex"),
    ranked5s: newestRank(rankHistory[2], "ranked 5s"),
  };
}
