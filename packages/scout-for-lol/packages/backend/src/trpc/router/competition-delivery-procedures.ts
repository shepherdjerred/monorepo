import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CompetitionIdSchema,
  DiscordGuildIdSchema,
  getCompetitionStatus,
  type CompetitionId,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import {
  CompetitionScheduledUpdatesSchema,
  computeNextScheduledUpdateAt,
} from "@scout-for-lol/data/model/competition-cron.ts";
import { getCompetitionById } from "#src/database/competition/queries.ts";
import { prisma } from "#src/database/index.ts";
import { clearCompetitionAnalysisCache } from "#src/league/competition/analysis.ts";
import { refreshAndCacheLeaderboard } from "#src/league/competition/refresh.ts";
import {
  loadCachedLeaderboard,
  loadHistoricalLeaderboardSnapshots,
} from "#src/storage/s3-leaderboard.ts";
import {
  guildMutationProcedure,
  guildProcedure,
} from "#src/trpc/guild-permission.ts";

const CompetitionIdInput = z.object({
  guildId: DiscordGuildIdSchema,
  competitionId: CompetitionIdSchema,
});

export const competitionDeliveryProcedures = {
  updateSchedule: guildMutationProcedure("competitions", "schedule")
    .input(
      CompetitionIdInput.extend({
        scheduledUpdates: CompetitionScheduledUpdatesSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const competition = await loadCompetitionOr404(
        input.competitionId,
        input.guildId,
      );
      const status = getCompetitionStatus(competition);
      if (status === "CANCELLED" || status === "ENDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot reschedule a ${status} competition.`,
        });
      }
      const now = new Date();
      const { enabled, cronExpression, timezone } = input.scheduledUpdates;
      return prisma.competition.update({
        where: { id: input.competitionId },
        data: {
          scheduledUpdatesEnabled: enabled,
          updateCronExpression: cronExpression,
          scheduleTimezone: timezone,
          nextScheduledUpdateAt:
            !enabled || competition.startProcessedAt === null
              ? null
              : computeNextScheduledUpdateAt(cronExpression, now, timezone),
          updatedTime: now,
        },
      });
    }),

  leaderboard: guildProcedure("competitions", "read")
    .input(CompetitionIdInput)
    .query(async ({ input }) => {
      await loadCompetitionOr404(input.competitionId, input.guildId);
      return loadCachedLeaderboard(input.competitionId);
    }),

  leaderboardHistory: guildProcedure("competitions", "read")
    .input(CompetitionIdInput)
    .query(async ({ input }) => {
      await loadCompetitionOr404(input.competitionId, input.guildId);
      return loadHistoricalLeaderboardSnapshots(input.competitionId);
    }),

  refreshLeaderboard: guildMutationProcedure("competitions", "refresh")
    .input(CompetitionIdInput)
    .mutation(async ({ input }) => {
      const competition = await loadCompetitionOr404(
        input.competitionId,
        input.guildId,
      );
      try {
        const entries = await refreshAndCacheLeaderboard(competition);
        clearCompetitionAnalysisCache();
        return { entries };
      } catch (error) {
        asBadRequest(error);
      }
    }),
};

function asBadRequest(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

async function loadCompetitionOr404(
  competitionId: CompetitionId,
  guildId: string,
): Promise<CompetitionWithCriteria> {
  const competition = await getCompetitionById(prisma, competitionId);
  if (competition?.serverId !== guildId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Competition not found",
    });
  }
  return competition;
}
