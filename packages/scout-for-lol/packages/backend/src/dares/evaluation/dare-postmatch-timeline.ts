import { dareMatchNeedsTimeline } from "#src/dares/evaluation/dare-match-timeline-need.ts";
import {
  capturePostmatchRanksForDares,
  type PostmatchRankChanges,
} from "#src/dares/lifecycle/dare-rank-capture.ts";
import { refreshPendingDareCallouts } from "#src/dares/presentation/dare-callout.ts";
import type { DareNotificationDisposition } from "#src/dares/presentation/notify/dare-status-intent.ts";
import { settleDaresForMatch } from "#src/dares/settlement/dare-settle.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";
import { fetchTimelineForDare } from "#src/league/tasks/postmatch/match-report-standard.ts";
import {
  type Player,
  type PlayerConfigEntry,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";

export type DarePostmatchTimelineDependencies = {
  needsTimeline: typeof dareMatchNeedsTimeline;
  fetchTimeline: typeof fetchTimelineForDare;
  settleDares: typeof settleDaresForMatch;
  captureRanks?: typeof capturePostmatchRanksForDares | undefined;
  refreshCallouts?: typeof refreshPendingDareCallouts | undefined;
};

const DEFAULT_DEPENDENCIES: DarePostmatchTimelineDependencies = {
  needsTimeline: dareMatchNeedsTimeline,
  fetchTimeline: fetchTimelineForDare,
  settleDares: settleDaresForMatch,
  captureRanks: capturePostmatchRanksForDares,
};

/** Keep required timeline capture ahead of immutable Dare evidence. */
export async function settleDaresWithTimeline(
  input: {
    matchData: RawMatch;
    matchDataSource: MatchDataSource;
    trackedPlayers: PlayerConfigEntry[];
    prismaClient?: ExtendedPrismaClient | undefined;
    /** Passed straight through; see `settleDaresForMatch`. */
    notify?: DareNotificationDisposition | undefined;
  },
  dependencies: DarePostmatchTimelineDependencies = DEFAULT_DEPENDENCIES,
): Promise<{
  dares: Awaited<ReturnType<typeof settleDaresForMatch>>;
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
  // shared resolver acquires timelines independently of result provenance.
  // Beta preparation waits until the persisted deadline, then pins missing
  // coverage; this read cannot silently reopen that processing decision.
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
  const dares = await dependencies.settleDares(input.matchData, prismaClient, {
    notify: input.notify,
  });
  const { send } = await import("#src/league/discord/channel.ts");
  const { defaultDareCalloutDependencies } =
    await import("#src/dares/presentation/dare-callout.ts");
  await (dependencies.refreshCallouts ?? refreshPendingDareCallouts)({
    prismaClient,
    sendMessage: send,
    editMessage: defaultDareCalloutDependencies.editMessage,
    mayPost: () => input.notify !== "withhold",
  });
  return {
    dares,
    prefetchedTimeline: timelineRequired ? (timeline ?? null) : undefined,
    prefetchedPlayers: rankCapture.players,
    prefetchedRankChanges: rankCapture.changes,
  };
}
