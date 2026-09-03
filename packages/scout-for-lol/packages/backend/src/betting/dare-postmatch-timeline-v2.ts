import {
  MatchIdSchema,
  type PlayerConfigEntry,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import { settleAndAwardBucks } from "#src/betting/postmatch-hook.ts";
import { dareV2MatchNeedsTimeline } from "#src/betting/dare-match-timeline-need.ts";
import { dareTimelineEvidenceFromRawV2 } from "#src/betting/dare-timeline-evidence-v2.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { fetchTimelineForDareV2 } from "#src/league/tasks/postmatch/match-report-standard.ts";

export type DarePostmatchTimelineV2Dependencies = {
  needsTimeline: typeof dareV2MatchNeedsTimeline;
  fetchTimeline: typeof fetchTimelineForDareV2;
  settleBucks: typeof settleAndAwardBucks;
};

const DEFAULT_DEPENDENCIES: DarePostmatchTimelineV2Dependencies = {
  needsTimeline: dareV2MatchNeedsTimeline,
  fetchTimeline: fetchTimelineForDareV2,
  settleBucks: settleAndAwardBucks,
};

/** Keep required timeline capture ahead of immutable Dare evidence. */
export async function settleBucksWithDareTimelineV2(
  input: {
    matchData: RawMatch;
    trackedPlayers: PlayerConfigEntry[];
    prismaClient?: ExtendedPrismaClient | undefined;
  },
  dependencies: DarePostmatchTimelineV2Dependencies = DEFAULT_DEPENDENCIES,
): Promise<{
  bucks: Awaited<ReturnType<typeof settleAndAwardBucks>>;
  prefetchedTimeline: RawTimeline | null | undefined;
}> {
  const prismaClient = input.prismaClient ?? prisma;
  const timelineRequired = await dependencies.needsTimeline(
    input.matchData,
    prismaClient,
  );
  const timeline = timelineRequired
    ? await dependencies.fetchTimeline(
        input.matchData,
        MatchIdSchema.parse(input.matchData.metadata.matchId),
        input.trackedPlayers,
      )
    : undefined;
  const bucks = await dependencies.settleBucks(input.matchData, prismaClient, {
    ...(timeline === undefined
      ? {}
      : { dareTimeline: dareTimelineEvidenceFromRawV2(timeline) }),
  });
  return {
    bucks,
    prefetchedTimeline: timelineRequired ? (timeline ?? null) : undefined,
  };
}
