import {
  MatchIdSchema,
  type Player,
  type PlayerConfigEntry,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  capturePostmatchRanksForDaresV3,
  type PostmatchRankChanges,
} from "#src/betting/dares/lifecycle/dare-rank-capture-v3.ts";
import { settleAndAwardBucks } from "#src/betting/markets/postmatch-hook.ts";
import { dareV2MatchNeedsTimeline } from "#src/betting/dares/evaluation/dare-match-timeline-need.ts";
import { dareTimelineEvidenceFromRawV2 } from "#src/betting/dares/presentation/dare-timeline-evidence-v2.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { SettlementAnnouncementSink } from "#src/betting/notify/announcement-sink.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";
import { fetchTimelineForDareV2 } from "#src/league/tasks/postmatch/match-report-standard.ts";

export type DarePostmatchTimelineV2Dependencies = {
  needsTimeline: typeof dareV2MatchNeedsTimeline;
  fetchTimeline: typeof fetchTimelineForDareV2;
  settleBucks: typeof settleAndAwardBucks;
  captureRanks?: typeof capturePostmatchRanksForDaresV3 | undefined;
};

const DEFAULT_DEPENDENCIES: DarePostmatchTimelineV2Dependencies = {
  needsTimeline: dareV2MatchNeedsTimeline,
  fetchTimeline: fetchTimelineForDareV2,
  settleBucks: settleAndAwardBucks,
  captureRanks: capturePostmatchRanksForDaresV3,
};

/** Keep required timeline capture ahead of immutable Dare evidence. */
export async function settleBucksWithDareTimelineV2(
  input: {
    matchData: RawMatch;
    matchDataSource: "RIOT" | "SCOUT_CLIENT";
    trackedPlayers: PlayerConfigEntry[];
    prismaClient?: ExtendedPrismaClient | undefined;
    /** Passed straight through; see `settleAndAwardBucks`. */
    announcementSink?: SettlementAnnouncementSink | undefined;
  },
  dependencies: DarePostmatchTimelineV2Dependencies = DEFAULT_DEPENDENCIES,
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
  // A canonical client result can fill Riot's match gap, but it cannot make a
  // Riot timeline exist. Carry explicit missing coverage into Dare evaluation
  // so those contracts enter their evidence-review path while every
  // match-payload-only market can still settle and the managed result can
  // finalize. Retrying Riot forever here would pin the shared client-match
  // dispatcher on a resource that cannot appear.
  const timeline =
    timelineRequired && input.matchDataSource === "RIOT"
      ? await dependencies.fetchTimeline(
          input.matchData,
          MatchIdSchema.parse(input.matchData.metadata.matchId),
          input.trackedPlayers,
        )
      : undefined;
  const dareTimeline =
    timelineRequired && input.matchDataSource === "SCOUT_CLIENT"
      ? { coverage: "missing" as const, events: [], participants: [] }
      : timeline === undefined
        ? undefined
        : dareTimelineEvidenceFromRawV2(timeline);
  const rankCapture = await (
    dependencies.captureRanks ?? capturePostmatchRanksForDaresV3
  )(
    {
      matchData: input.matchData,
      trackedPlayers: input.trackedPlayers,
    },
    { prismaClient, getRank: getRankByPuuid },
  );
  const bucks = await dependencies.settleBucks(input.matchData, prismaClient, {
    ...(dareTimeline === undefined ? {} : { dareTimeline }),
    ...(input.announcementSink === undefined
      ? {}
      : { announcementSink: input.announcementSink }),
  });
  return {
    bucks,
    prefetchedTimeline: timelineRequired ? (timeline ?? null) : undefined,
    prefetchedPlayers: rankCapture.players,
    prefetchedRankChanges: rankCapture.changes,
  };
}
