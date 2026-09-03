import {
  DareContractV3Schema,
  MatchIdSchema,
  rankForQueue,
  resolveQueueTypeFromGame,
  type Player,
  type PlayerConfigEntry,
  type Rank,
  type Ranks,
  type RawMatch,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  getLatestRankBefore,
  saveMatchRankHistory,
} from "#src/league/model/rank-history.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";

export type PostmatchRankChanges = ReadonlyMap<
  string,
  { before: Rank | undefined; after: Rank | undefined }
>;

export type DareRankCaptureV3Dependencies = {
  prismaClient: ExtendedPrismaClient;
  getRank: typeof getRankByPuuid;
};

const DEFAULT_DEPENDENCIES: DareRankCaptureV3Dependencies = {
  prismaClient: prisma,
  getRank: getRankByPuuid,
};

function storedRanks(ranks: Ranks) {
  return {
    soloRank: ranks.solo === undefined ? null : JSON.stringify(ranks.solo),
    flexRank: ranks.flex === undefined ? null : JSON.stringify(ranks.flex),
    ranked5sRank:
      ranks.ranked5s === undefined ? null : JSON.stringify(ranks.ranked5s),
  };
}

async function rankRequiredPuuids(
  matchData: RawMatch,
  queue: "solo" | "flex",
  prismaClient: ExtendedPrismaClient,
): Promise<Set<string>> {
  const rows = await prismaClient.bucksDareV2.findMany({
    where: {
      dareState: "active",
      contractJson: { not: null },
      deadlineAt: { gte: new Date(matchData.info.gameEndTimestamp) },
    },
    select: { contractJson: true },
  });
  return rankRequiredPuuidsV3(
    matchData,
    queue,
    rows.flatMap((row) =>
      row.contractJson === null ? [] : [row.contractJson],
    ),
  );
}

export function rankRequiredPuuidsV3(
  matchData: RawMatch,
  queue: "solo" | "flex",
  serializedContracts: readonly string[],
): Set<string> {
  const participants = new Set(matchData.metadata.participants);
  const required = new Set<string>();
  for (const serialized of serializedContracts) {
    const parsed = DareContractV3Schema.safeParse(JSON.parse(serialized));
    if (
      !parsed.success ||
      parsed.data.activation.kind !== "rank" ||
      parsed.data.activation.queue !== queue
    ) {
      continue;
    }
    for (const target of parsed.data.targets) {
      for (const account of target.accounts) {
        if (participants.has(account.puuid)) required.add(account.puuid);
      }
    }
  }
  return required;
}

/**
 * Capture the post-game rank before Dare evidence is allowed to advance. A
 * Riot failure is cursor-blocking only for accounts required by an active
 * rank Dare; ordinary reports retain their existing best-effort behavior.
 */
export async function capturePostmatchRanksForDaresV3(
  input: {
    matchData: RawMatch;
    trackedPlayers: PlayerConfigEntry[];
    now?: Date | undefined;
  },
  dependencies: DareRankCaptureV3Dependencies = DEFAULT_DEPENDENCIES,
): Promise<{
  players: Player[] | undefined;
  changes: PostmatchRankChanges | undefined;
}> {
  const queue = resolveQueueTypeFromGame(
    input.matchData.info.queueId,
    input.matchData.info.gameMode,
    input.matchData.info.gameType,
  );
  if (queue !== "solo" && queue !== "flex") {
    return { players: undefined, changes: undefined };
  }
  const required = await rankRequiredPuuids(
    input.matchData,
    queue,
    dependencies.prismaClient,
  );
  const matchId = MatchIdSchema.parse(input.matchData.metadata.matchId);
  const capturedAt = input.now ?? new Date();
  const changes = new Map<
    string,
    { before: Rank | undefined; after: Rank | undefined }
  >();
  const players: Player[] = [];
  for (const config of input.trackedPlayers) {
    const { puuid, region } = config.league.leagueAccount;
    const lookup = await dependencies.getRank(puuid, region);
    if (lookup.status === "error") {
      if (required.has(puuid)) {
        throw new Error(
          `Rank capture required by an active Dare failed for ${config.alias}.`,
        );
      }
      players.push({
        config,
        ranks: { solo: undefined, flex: undefined, ranked5s: undefined },
      });
      continue;
    }
    const current = rankForQueue(lookup.ranks, queue);
    const previous = await getLatestRankBefore(
      puuid,
      queue,
      input.matchData.info.gameEndTimestamp,
      dependencies.prismaClient,
    );
    await saveMatchRankHistory({
      matchId,
      puuid,
      queueType: queue,
      rankBefore: previous,
      rankAfter: current,
      matchGameCreationTimestamp: input.matchData.info.gameCreation,
      matchGameEndTimestamp: input.matchData.info.gameEndTimestamp,
      prismaClient: dependencies.prismaClient,
      capturedAt,
    });
    await dependencies.prismaClient.currentRankSnapshot.upsert({
      where: { puuid },
      create: { puuid, ...storedRanks(lookup.ranks), fetchedAt: capturedAt },
      update: { ...storedRanks(lookup.ranks), fetchedAt: capturedAt },
    });
    changes.set(puuid, { before: previous, after: current });
    players.push({ config, ranks: lookup.ranks });
  }
  return { players, changes };
}
