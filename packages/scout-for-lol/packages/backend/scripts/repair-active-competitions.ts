import {
  type CachedLeaderboard,
  type CompetitionCriteria,
  type CompetitionWithCriteria,
  type MatchId,
  type Region,
  getCompetitionStatus,
  parseCompetition,
} from "@scout-for-lol/data/index.ts";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { competitionWithSeasonInclude } from "#src/database/competition/include.ts";
import { createSnapshot } from "#src/league/competition/snapshots.ts";
import { calculateLeaderboard } from "#src/league/competition/leaderboard.ts";
import { fetchMatchIdsForTimeRange } from "#src/league/tasks/recovery/backfill-to-s3.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { saveMatchToS3 } from "#src/storage/s3.ts";
import { saveCachedLeaderboard } from "#src/storage/s3-leaderboard.ts";

const ArgsSchema = z.object({
  apply: z.boolean(),
  maxMatchesPerCompetition: z.number().int().positive().optional(),
});

type RepairArgs = z.infer<typeof ArgsSchema>;

function parseArgs(argv: string[]): RepairArgs {
  let apply = false;
  let maxMatchesPerCompetition: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      apply = false;
    } else if (arg === "--max-matches-per-competition") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--max-matches-per-competition requires a value");
      }
      maxMatchesPerCompetition = z.coerce
        .number()
        .int()
        .positive()
        .parse(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return ArgsSchema.parse({
    apply,
    ...(maxMatchesPerCompetition === undefined
      ? {}
      : { maxMatchesPerCompetition }),
  });
}

function criteriaNeedsMatchData(criteria: CompetitionCriteria): boolean {
  switch (criteria.type) {
    case "MOST_GAMES_PLAYED":
    case "MOST_WINS_PLAYER":
    case "MOST_WINS_CHAMPION":
    case "HIGHEST_WIN_RATE":
      return true;
    case "HIGHEST_RANK":
    case "MOST_RANK_CLIMB":
      return false;
  }
}

async function createMissingRankBaselines(
  competition: CompetitionWithCriteria,
  apply: boolean,
): Promise<number> {
  if (competition.criteria.type !== "MOST_RANK_CLIMB") {
    return 0;
  }

  const participants = await prisma.competitionParticipant.findMany({
    where: { competitionId: competition.id, joinedAt: { not: null } },
    select: { playerId: true },
  });
  const existingSnapshots = await prisma.competitionSnapshot.findMany({
    where: { competitionId: competition.id, snapshotType: "START" },
    select: { playerId: true },
  });
  const existingPlayerIds = new Set(
    existingSnapshots.map((snapshot) => snapshot.playerId),
  );
  const missing = participants.filter(
    (participant) => !existingPlayerIds.has(participant.playerId),
  );

  if (apply) {
    for (const participant of missing) {
      await createSnapshot(prisma, {
        competitionId: competition.id,
        playerId: participant.playerId,
        snapshotType: "START",
        criteria: competition.criteria,
      });
    }
  }

  return missing.length;
}

async function collectMatchIds(competition: CompetitionWithCriteria): Promise<{
  matchIds: MatchId[];
  aliasesByMatchId: Map<MatchId, string[]>;
  regionByMatchId: Map<MatchId, Region>;
  participantCount: number;
  accountCount: number;
}> {
  if (
    !criteriaNeedsMatchData(competition.criteria) ||
    competition.startDate === null
  ) {
    return {
      matchIds: [],
      aliasesByMatchId: new Map(),
      regionByMatchId: new Map(),
      participantCount: 0,
      accountCount: 0,
    };
  }

  const participants = await prisma.competitionParticipant.findMany({
    where: { competitionId: competition.id, joinedAt: { not: null } },
    include: { player: { include: { accounts: true } } },
  });
  const startSeconds = Math.floor(competition.startDate.getTime() / 1000);
  const windowEndMs = Math.min(
    Date.now(),
    competition.endDate?.getTime() ?? Date.now(),
  );
  const endSeconds = Math.floor(windowEndMs / 1000);
  const matchIds = new Set<MatchId>();
  const aliasesByMatchId = new Map<MatchId, string[]>();
  const regionByMatchId = new Map<MatchId, Region>();

  for (const participant of participants) {
    for (const account of participant.player.accounts) {
      const accountMatchIds = await fetchMatchIdsForTimeRange(
        account.puuid,
        account.region,
        startSeconds,
        endSeconds,
      );
      for (const matchId of accountMatchIds) {
        matchIds.add(matchId);
        aliasesByMatchId.set(matchId, [
          ...(aliasesByMatchId.get(matchId) ?? []),
          account.alias,
        ]);
        if (!regionByMatchId.has(matchId)) {
          regionByMatchId.set(matchId, account.region);
        }
      }
    }
  }

  return {
    matchIds: [...matchIds],
    aliasesByMatchId,
    regionByMatchId,
    participantCount: participants.length,
    accountCount: participants.reduce(
      (total, participant) => total + participant.player.accounts.length,
      0,
    ),
  };
}

async function repairCompetition(
  competition: CompetitionWithCriteria,
  args: RepairArgs,
) {
  const missingRankBaselines = await createMissingRankBaselines(
    competition,
    args.apply,
  );
  const matches = await collectMatchIds(competition);
  const matchIds =
    args.maxMatchesPerCompetition === undefined
      ? matches.matchIds
      : matches.matchIds.slice(0, args.maxMatchesPerCompetition);
  let matchesSaved = 0;
  let matchesFailed = 0;

  if (args.apply) {
    for (const matchId of matchIds) {
      const region = matches.regionByMatchId.get(matchId);
      if (region === undefined) {
        matchesFailed += 1;
        continue;
      }
      const matchData = await fetchMatchData(matchId, region);
      if (matchData === undefined) {
        matchesFailed += 1;
        continue;
      }
      await saveMatchToS3(
        matchData,
        matches.aliasesByMatchId.get(matchId) ?? [],
      );
      matchesSaved += 1;
    }

    const leaderboard = await calculateLeaderboard(prisma, competition);
    const cachedLeaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: competition.id,
      calculatedAt: new Date().toISOString(),
      entries: leaderboard,
    };
    await saveCachedLeaderboard(cachedLeaderboard);
  }

  return {
    competitionId: competition.id,
    title: competition.title,
    participants: matches.participantCount,
    accounts: matches.accountCount,
    missingRankBaselines,
    matchIdsFound: matches.matchIds.length,
    matchesSaved,
    matchesFailed,
    leaderboardRefreshed: args.apply,
  };
}

export async function repairActiveCompetitions(args: RepairArgs) {
  const rawCompetitions = await prisma.competition.findMany({
    where: { isCancelled: false },
    include: competitionWithSeasonInclude,
  });
  const activeCompetitions = rawCompetitions
    .map((competition) => parseCompetition(competition))
    .filter((competition) => getCompetitionStatus(competition) === "ACTIVE");
  const competitions = [];

  for (const competition of activeCompetitions) {
    competitions.push(await repairCompetition(competition, args));
  }

  return {
    mode: args.apply ? "apply" : "dry-run",
    competitionsChecked: rawCompetitions.length,
    activeCompetitions: activeCompetitions.length,
    competitions,
  };
}

if (import.meta.main) {
  try {
    const summary = await repairActiveCompetitions(
      parseArgs(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
