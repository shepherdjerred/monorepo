import {
  PlayerRankHistorySchema,
  RankSchema,
  RankedQueueTypeSchema,
  buildPlayerRankHistory,
  type DiscordGuildId,
  type PlayerId,
  type PlayerRankHistory,
  type Rank,
  type RankHistoryObservation,
  type RankedQueueType,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  resolveConsumerPlayerPuuids,
  resolveGuildPuuids,
  type ProfileAccount,
} from "#src/lib/player-profile/profile-resolution.ts";
import type { PlayerLookupInput } from "#src/lib/player-admin/shared.ts";
import type { z } from "zod";

function accountLabel(account: ProfileAccount): string {
  if (account.riotGameName === null || account.riotGameName.length === 0) {
    return "Unknown account";
  }
  return account.riotTagLine === null || account.riotTagLine.length === 0
    ? account.riotGameName
    : `${account.riotGameName}#${account.riotTagLine}`;
}

function parseStoredRank(serialized: string | null): Rank | undefined {
  return serialized === null || serialized.length === 0
    ? undefined
    : RankSchema.parse(JSON.parse(serialized));
}

type RankSnapshotRow = {
  puuid: string;
  soloRank: string | null;
  flexRank: string | null;
  ranked5sRank: string | null;
  fetchedAt: Date;
};

function snapshotRank(
  snapshot: RankSnapshotRow,
  queue: RankedQueueType,
): Rank | undefined {
  if (queue === "solo") return parseStoredRank(snapshot.soloRank);
  return queue === "flex"
    ? parseStoredRank(snapshot.flexRank)
    : parseStoredRank(snapshot.ranked5sRank);
}

function matchObservations(
  rows: {
    puuid: string;
    queueType: string;
    rankAfter: string | null;
    rankBefore: string | null;
    matchGameEndAt: Date | null;
    capturedAt: Date;
  }[],
): {
  observations: RankHistoryObservation[];
  latestMatchAt: Map<string, number>;
} {
  const observations: RankHistoryObservation[] = [];
  const latestMatchAt = new Map<string, number>();
  for (const row of rows) {
    const queue = RankedQueueTypeSchema.parse(row.queueType);
    const rank = parseStoredRank(row.rankAfter);
    if (rank === undefined) {
      continue;
    }
    const at = row.matchGameEndAt ?? row.capturedAt;
    const rankBefore = parseStoredRank(row.rankBefore);
    observations.push({
      puuid: row.puuid,
      queue,
      at,
      rank,
      ...(rankBefore === undefined ? {} : { rankBefore }),
    });
    const key = `${row.puuid}:${queue}`;
    const previous = latestMatchAt.get(key);
    if (previous === undefined || at.getTime() > previous) {
      latestMatchAt.set(key, at.getTime());
    }
  }
  return { observations, latestMatchAt };
}

function newerSnapshotObservations(
  snapshots: RankSnapshotRow[],
  latestMatchAt: Map<string, number>,
): RankHistoryObservation[] {
  const observations: RankHistoryObservation[] = [];
  for (const snapshot of snapshots) {
    for (const queue of RankedQueueTypeSchema.options) {
      const rank = snapshotRank(snapshot, queue);
      if (rank === undefined) {
        continue;
      }
      const latest = latestMatchAt.get(`${snapshot.puuid}:${queue}`);
      if (latest === undefined || snapshot.fetchedAt.getTime() <= latest) {
        continue;
      }
      observations.push({
        puuid: snapshot.puuid,
        queue,
        at: snapshot.fetchedAt,
        rank,
      });
    }
  }
  return observations;
}

async function rankHistoryForAccounts(
  accounts: ProfileAccount[],
  now: Date,
): Promise<PlayerRankHistory> {
  const labeled = accounts.map((account) => ({
    puuid: account.puuid,
    label: accountLabel(account),
  }));
  if (accounts.length === 0) {
    return buildPlayerRankHistory({
      now,
      accounts: labeled,
      observations: [],
    });
  }
  const puuids = accounts.map((account) => account.puuid);
  const [rows, snapshots] = await Promise.all([
    prisma.matchRankHistory.findMany({
      where: {
        puuid: { in: puuids },
        queueType: { in: [...RankedQueueTypeSchema.options] },
      },
    }),
    prisma.currentRankSnapshot.findMany({
      where: { puuid: { in: puuids } },
    }),
  ]);

  const matches = matchObservations(rows);
  const observations = [
    ...matches.observations,
    ...newerSnapshotObservations(snapshots, matches.latestMatchAt),
  ];

  return PlayerRankHistorySchema.parse(
    buildPlayerRankHistory({
      now,
      accounts: labeled,
      observations,
    }),
  );
}

export async function getPlayerRankHistory(
  input: z.infer<typeof PlayerLookupInput>,
  now: Date = new Date(),
): Promise<PlayerRankHistory> {
  const player = await resolveGuildPuuids(input);
  return rankHistoryForAccounts(player.accounts, now);
}

export async function getConsumerPlayerRankHistory(
  input: {
    playerId: PlayerId;
    guildIds: DiscordGuildId[];
  },
  now: Date = new Date(),
): Promise<PlayerRankHistory> {
  const player = await resolveConsumerPlayerPuuids(input);
  return rankHistoryForAccounts(player.accounts, now);
}
