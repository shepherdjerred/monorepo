import {
  MatchIdSchema,
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
    matchDataSource: "RIOT" | "SCOUT_CLIENT";
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
  // one has it fetched (and retained) before its evidence is evaluated. A
  // canonical client result can fill Riot's match gap but cannot make a Riot
  // timeline exist; the contract's evidence then records missing timeline
  // coverage rather than this retrying Riot forever and pinning the shared
  // client-match dispatcher on a resource that cannot appear.
  const timeline =
    timelineRequired && input.matchDataSource === "RIOT"
      ? await dependencies.fetchTimeline(
          input.matchData,
          MatchIdSchema.parse(input.matchData.metadata.matchId),
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
