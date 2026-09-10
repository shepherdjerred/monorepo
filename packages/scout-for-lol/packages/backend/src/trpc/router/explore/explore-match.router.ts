import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  MatchIdSchema,
  TimelineCursorSchema,
  TimelineEventFilterSchema,
} from "@scout-for-lol/data";
import { assertExploreAccess } from "#src/explore/access.ts";
import { exploreMatchSnapshot } from "#src/explore-match/match-view.ts";
import {
  fetchFullMatch,
  fetchTimelineChartFrames,
  fetchTimelineCoverage,
  fetchTimelineEventPage,
  fetchTimelineFramePage,
} from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

const PAGE_SIZE = 100;
const KEY_EVENT_TYPES = [
  "CHAMPION_KILL",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "GAME_END",
];

const MatchInput = z.object({ matchId: MatchIdSchema });
const TimelinePageInput = MatchInput.extend({
  participantIds: TimelineEventFilterSchema.shape.participantIds,
  cursor: TimelineCursorSchema.optional(),
});
const TimelineEventPageInput = TimelinePageInput.extend({
  eventTypes: TimelineEventFilterSchema.shape.eventTypes,
});

async function assertExploreMatch(
  user: Parameters<typeof assertExploreAccess>[0],
  matchId: string,
) {
  await assertExploreAccess(user);
  const rows = await fetchFullMatch({ matchId });
  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Match was not found" });
  }
  return rows;
}

function pageResult<T>(rows: T[], offset: number) {
  const page = rows.slice(0, PAGE_SIZE);
  return {
    rows: page,
    nextCursor: rows.length > PAGE_SIZE ? { offset: offset + PAGE_SIZE } : null,
  };
}

function participantFilter(participantIds: number[] | undefined) {
  return participantIds === undefined ? {} : { participantIds };
}

export const exploreMatchRouter = router({
  detail: protectedProcedure.input(MatchInput).query(async ({ ctx, input }) => {
    const rows = await assertExploreMatch(ctx.user, input.matchId);
    const [coverage, keyEvents] = await Promise.all([
      fetchTimelineCoverage({ matchId: input.matchId }),
      fetchTimelineEventPage({
        matchId: input.matchId,
        offset: 0,
        limit: 40,
        eventTypes: KEY_EVENT_TYPES,
      }),
    ]);
    return {
      match: exploreMatchSnapshot(rows),
      timeline: { coverage, keyEvents },
    };
  }),

  events: protectedProcedure
    .input(TimelineEventPageInput)
    .query(async ({ ctx, input }) => {
      await assertExploreMatch(ctx.user, input.matchId);
      const offset = input.cursor?.offset ?? 0;
      const rows = await fetchTimelineEventPage({
        matchId: input.matchId,
        offset,
        limit: PAGE_SIZE + 1,
        ...(input.eventTypes === undefined
          ? {}
          : { eventTypes: input.eventTypes }),
        ...participantFilter(input.participantIds),
      });
      return pageResult(rows, offset);
    }),

  frames: protectedProcedure
    .input(TimelinePageInput)
    .query(async ({ ctx, input }) => {
      await assertExploreMatch(ctx.user, input.matchId);
      const offset = input.cursor?.offset ?? 0;
      const rows = await fetchTimelineFramePage({
        matchId: input.matchId,
        offset,
        limit: PAGE_SIZE + 1,
        ...participantFilter(input.participantIds),
      });
      return pageResult(rows, offset);
    }),

  chartSeries: protectedProcedure
    .input(MatchInput)
    .query(async ({ ctx, input }) => {
      const rows = await assertExploreMatch(ctx.user, input.matchId);
      const frames = await fetchTimelineChartFrames({ matchId: input.matchId });
      const teamByParticipant = new Map(
        rows.map((row) => [row.participant_id, row.team_id] as const),
      );
      const points = new Map<number, Map<number, number>>();
      for (const frame of frames) {
        const teamId = teamByParticipant.get(frame.participant_id);
        if (teamId === undefined) {
          throw new Error("Timeline frame references an unknown participant");
        }
        const teamGold = points.get(frame.frame_timestamp_ms) ?? new Map();
        teamGold.set(teamId, (teamGold.get(teamId) ?? 0) + frame.total_gold);
        points.set(frame.frame_timestamp_ms, teamGold);
      }
      return {
        points: [...points.entries()]
          .toSorted(([left], [right]) => left - right)
          .map(([timestampMs, teamGold]) => ({
            timestampMs,
            teamGold: [...teamGold.entries()]
              .toSorted(([left], [right]) => left - right)
              .map(([teamId, gold]) => ({ teamId, gold })),
            selectedGold: null,
            selectedXp: null,
          })),
      };
    }),
});
