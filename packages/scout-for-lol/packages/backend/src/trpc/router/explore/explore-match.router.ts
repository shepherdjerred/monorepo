import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  MatchIdSchema,
  TimelineCursorSchema,
  TimelineEventFilterSchema,
} from "@scout-for-lol/data";
import { assertExploreAccess } from "#src/explore/access.ts";
import {
  exploreMatchSnapshot,
  isExploreMatchSnapshotSupported,
} from "#src/explore-match/match-view.ts";
import {
  fetchFullMatch,
  fetchFullMatchTeams,
  fetchTimelineChartFrames,
  fetchTimelineCoverage,
  fetchTimelineEventPage,
} from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import {
  fetchMatchTimelineEvents,
  fetchMatchTimelineFrames,
  MATCH_KEY_EVENT_TYPES,
} from "#src/trpc/router/match-timeline.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

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
  const first = rows[0];
  if (
    first === undefined ||
    !isExploreMatchSnapshotSupported(first.queue_id, first.game_mode)
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Match was not found" });
  }
  return rows;
}

export const exploreMatchRouter = router({
  detail: protectedProcedure.input(MatchInput).query(async ({ ctx, input }) => {
    const rows = await assertExploreMatch(ctx.user, input.matchId);
    const [coverage, keyEvents, teamRows] = await Promise.all([
      fetchTimelineCoverage({ matchId: input.matchId }),
      fetchTimelineEventPage({
        matchId: input.matchId,
        offset: 0,
        limit: 40,
        eventTypes: MATCH_KEY_EVENT_TYPES,
      }),
      fetchFullMatchTeams({ matchId: input.matchId }),
    ]);
    return {
      match: exploreMatchSnapshot(rows, teamRows),
      timeline: { coverage, keyEvents },
    };
  }),

  events: protectedProcedure
    .input(TimelineEventPageInput)
    .query(async ({ ctx, input }) => {
      await assertExploreMatch(ctx.user, input.matchId);
      return await fetchMatchTimelineEvents(input);
    }),

  frames: protectedProcedure
    .input(TimelinePageInput)
    .query(async ({ ctx, input }) => {
      await assertExploreMatch(ctx.user, input.matchId);
      return await fetchMatchTimelineFrames(input);
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
