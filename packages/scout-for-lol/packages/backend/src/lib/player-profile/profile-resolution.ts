import type { DiscordAccountId } from "@scout-for-lol/domain/identity/discord.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  LeaguePuuidSchema,
  RankSchema,
  type DiscordGuildId,
  type PlayerId,
  type Rank,
} from "@scout-for-lol/data";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client/index.js";
import { prisma } from "#src/database/index.ts";
import { getPlayerOrThrow, notFound } from "#src/lib/player-admin/shared.ts";

export type ProfileAccount = {
  puuid: LeaguePuuid;
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
  discordId: DiscordAccountId | null;
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
  guildId: DiscordGuildId;
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
}): Promise<ResolvedPlayerProfile & { guildId: DiscordGuildId }> {
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
      return queueType === "flex"
        ? entry.flexRank !== null
        : entry.ranked5sRank !== null;
    });
    const snapshotValue =
      queueType === "solo"
        ? snapshot?.soloRank
        : queueType === "flex"
          ? snapshot?.flexRank
          : snapshot?.ranked5sRank;
    return snapshot !== undefined &&
      (live == null || snapshot.fetchedAt > live.capturedAt)
      ? parseRank(snapshotValue ?? null)
      : parseRank(live?.rankAfter ?? null);
  }

  return {
    solo: newestRank(rankHistory[0], "solo"),
    flex: newestRank(rankHistory[1], "flex"),
    ranked5s: newestRank(rankHistory[2], "ranked 5s"),
  };
}

/** A rank and the moment Scout learned it. */
export type RankEvidence = { rank: Rank; at: Date };

export type PuuidRanks = {
  solo: RankEvidence | undefined;
  flex: RankEvidence | undefined;
  ranked5s: RankEvidence | undefined;
};

const RankEvidenceRowsSchema = z.array(
  z.object({
    puuid: LeaguePuuidSchema,
    queue: z.enum(["solo", "flex", "ranked 5s"]),
    rank: z.string(),
    at: z.date(),
    captured_at: z.date(),
    source: z.enum(["history", "snapshot"]),
  }),
);

function rankRowKey(row: { puuid: LeaguePuuid; queue: string }): string {
  return `${row.puuid}\u0000${row.queue}`;
}

/**
 * Latest known rank per queue for each of many accounts, in one query.
 *
 * Same rule as {@link latestRanks}: the newest ranked game's `rankAfter` per
 * queue, unless a current-rank snapshot was fetched after that game was
 * recorded. Each rank carries when Scout learned it (`at`), so a caller
 * holding several accounts for one person can take the freshest. Accounts with
 * no rank evidence are absent from the map.
 */
export async function latestRanksByPuuid(
  puuids: LeaguePuuid[],
): Promise<Map<LeaguePuuid, PuuidRanks>> {
  const result = new Map<LeaguePuuid, PuuidRanks>();
  if (puuids.length === 0) return result;
  const list = Prisma.join(puuids);
  const rows = RankEvidenceRowsSchema.parse(
    await prisma.$queryRaw(
      Prisma.sql`
        WITH history AS (
          SELECT DISTINCT ON (puuid, "queueType")
            puuid,
            "queueType" AS queue,
            "rankAfter" AS rank,
            COALESCE("matchGameEndAt", "capturedAt") AS at,
            "capturedAt" AS captured_at
          FROM "MatchRankHistory"
          WHERE puuid IN (${list})
            AND "queueType" IN ('solo', 'flex', 'ranked 5s')
            AND "rankAfter" IS NOT NULL
          ORDER BY puuid, "queueType",
            "matchGameEndAt" DESC NULLS LAST, "capturedAt" DESC
        ),
        snapshot AS (
          SELECT puuid, 'solo' AS queue, "soloRank" AS rank,
            "fetchedAt" AS at, "fetchedAt" AS captured_at
          FROM "CurrentRankSnapshot"
          WHERE puuid IN (${list}) AND "soloRank" IS NOT NULL
          UNION ALL
          SELECT puuid, 'flex', "flexRank", "fetchedAt", "fetchedAt"
          FROM "CurrentRankSnapshot"
          WHERE puuid IN (${list}) AND "flexRank" IS NOT NULL
          UNION ALL
          SELECT puuid, 'ranked 5s', "ranked5sRank", "fetchedAt", "fetchedAt"
          FROM "CurrentRankSnapshot"
          WHERE puuid IN (${list}) AND "ranked5sRank" IS NOT NULL
        )
        SELECT puuid, queue, rank, at, captured_at, 'history' AS source FROM history
        UNION ALL
        SELECT puuid, queue, rank, at, captured_at, 'snapshot' AS source FROM snapshot
      `,
    ),
  );

  const history = new Map(
    rows
      .filter((row) => row.source === "history")
      .map((row) => [rankRowKey(row), row]),
  );
  const snapshots = new Map(
    rows
      .filter((row) => row.source === "snapshot")
      .map((row) => [rankRowKey(row), row]),
  );
  for (const entry of [...history.values(), ...snapshots.values()]) {
    const key = rankRowKey(entry);
    const live = history.get(key);
    const snapshot = snapshots.get(key);
    const chosen =
      snapshot !== undefined &&
      (live === undefined || snapshot.captured_at > live.captured_at)
        ? snapshot
        : live;
    const rank = parseRank(chosen?.rank ?? null);
    if (chosen === undefined || rank === undefined) continue;
    const ranks = result.get(entry.puuid) ?? {
      solo: undefined,
      flex: undefined,
      ranked5s: undefined,
    };
    const evidence = { rank, at: chosen.at };
    if (entry.queue === "solo") ranks.solo = evidence;
    else if (entry.queue === "flex") ranks.flex = evidence;
    else ranks.ranked5s = evidence;
    result.set(entry.puuid, ranks);
  }
  return result;
}
