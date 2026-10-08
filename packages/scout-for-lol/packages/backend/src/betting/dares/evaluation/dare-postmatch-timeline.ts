import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";
import {
  type Player,
  type PlayerConfigEntry,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  capturePostmatchRanksForDares,
  type PostmatchRankChanges,
} from "#src/betting/dares/lifecycle/dare-rank-capture.ts";
import { settleAndAwardBucks } from "#src/betting/markets/postmatch-hook.ts";
import { dareMatchNeedsTimeline } from "#src/betting/dares/evaluation/dare-match-timeline-need.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { SettlementAnnouncementSink } from "#src/betting/notify/announcement-sink.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";
import { fetchTimelineForDare } from "#src/league/tasks/postmatch/match-report-standard.ts";

export type DarePostmatchTimelineDependencies = {
  needsTimeline: typeof dareMatchNeedsTimeline;
  fetchTimeline: typeof fetchTimelineForDare;
  settleBucks: typeof settleAndAwardBucks;
  captureRanks?: typeof capturePostmatchRanksForDares | undefined;
};

const DEFAULT_DEPENDENCIES: DarePostmatchTimelineDependencies = {
  needsTimeline: dareMatchNeedsTimeline,
  fetchTimeline: fetchTimelineForDare,
  settleBucks: settleAndAwardBucks,
  captureRanks: capturePostmatchRanksForDares,
};

/** Keep required timeline capture ahead of immutable Dare evidence. */
export async function settleBucksWithDareTimeline(
  input: {
    matchData: RawMatch;
    matchDataSource: MatchDataSource;
    trackedPlayers: PlayerConfigEntry[];
    prismaClient?: ExtendedPrismaClient | undefined;
    /** Passed straight through; see `settleAndAwardBucks`. */
    announcementSink?: SettlementAnnouncementSink | undefined;
  },
  dependencies: DarePostmatchTimelineDependencies = DEFAULT_DEPENDENCIES,
): Promise<{
  bucks: Awaited<ReturnType<typeof settleAndAwardBucks>>;
  prefetchedTimeline: RawTimeline | null | undefined;
  prefetchedPlayers: Player[] | undefined;
  prefetchedRankChanges: PostmatchRankChanges | undefined;
}> {
  const prismaClient = input.prismaClient ?? prisma;
  const timelineRequired = await dependencies.needsTimeline(
    input.matchData,
    prismaClient,
  );
  // Dare SQL reads the timeline from the report lake, so a contract that needs
  // one has it fetched (and staged) before its evidence is evaluated. The
  // fetch reads a client-sourced match's timeline from the client, never from
  // Riot, where waiting would pin the shared client-match dispatcher on a
  // resource that cannot appear. A client that sent none stages nothing, and
  // the contract's evidence records missing timeline coverage.
  const timeline = timelineRequired
    ? await dependencies.fetchTimeline(
        input.matchData,
        input.matchData.metadata.matchId,
        input.trackedPlayers,
      )
    : undefined;
  const rankCapture = await (
    dependencies.captureRanks ?? capturePostmatchRanksForDares
  )(
    {
      matchData: input.matchData,
      trackedPlayers: input.trackedPlayers,
    },
    { prismaClient, getRank: getRankByPuuid },
  );
  const bucks = await dependencies.settleBucks(
    input.matchData,
    prismaClient,
    input.announcementSink === undefined
      ? {}
      : { announcementSink: input.announcementSink },
  );
  return {
    bucks,
    prefetchedTimeline: timelineRequired ? (timeline ?? null) : undefined,
    prefetchedPlayers: rankCapture.players,
    prefetchedRankChanges: rankCapture.changes,
  };
}
