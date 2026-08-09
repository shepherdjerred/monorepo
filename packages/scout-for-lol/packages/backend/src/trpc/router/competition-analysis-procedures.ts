import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CompetitionAnalysisPresetSchema,
  CompetitionIdSchema,
  DiscordGuildIdSchema,
  type CompetitionId,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import { ReportScheduleTimezoneSchema } from "@scout-for-lol/data/model/competition-cron.ts";
import { getCompetitionById } from "#src/database/competition/queries.ts";
import { prisma } from "#src/database/index.ts";
import {
  analyzeCompetition,
  cachedCompetitionAnalysis,
} from "#src/league/competition/analysis.ts";
import { resolveCompetitionAnalysisDates } from "#src/league/competition/analysis-dates.ts";
import { mergeCompetitionRankHistory } from "#src/league/competition/analysis-results.ts";
import { fetchCompetitionRankHistory } from "#src/reports/duckdb/lake-reads.ts";
import {
  loadCachedLeaderboard,
  loadHistoricalLeaderboardSnapshots,
} from "#src/storage/s3-leaderboard.ts";
import {
  guildMutationProcedure,
  guildProcedure,
} from "#src/trpc/guild-permission.ts";

const CompetitionAnalysisInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  competitionId: CompetitionIdSchema,
  mode: z.enum(["official", "selected_period"]).default("official"),
  preset: CompetitionAnalysisPresetSchema.default("criterion_score"),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
});

const CompetitionTimezoneInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  competitionId: CompetitionIdSchema,
  timezone: ReportScheduleTimezoneSchema,
});

export const competitionAnalysisProcedures = {
  analysis: guildProcedure("competitions", "read")
    .input(CompetitionAnalysisInputSchema)
    .query(async ({ input }) => {
      const competition = await loadCompetitionOr404(
        input.competitionId,
        input.guildId,
      );
      const now = new Date();
      const { startDate, endDate } = resolveCompetitionAnalysisDates({
        competition,
        mode: input.mode,
        ...(input.startDate === undefined
          ? {}
          : { startDate: input.startDate }),
        ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
        now,
      });
      try {
        const cacheKey = [
          input.competitionId.toString(),
          input.mode,
          input.preset,
          startDate,
          endDate,
          competition.analysisTimezone,
        ].join(":");
        return await cachedCompetitionAnalysis(cacheKey, async () => {
          const [lakeHistory, authoritativeHistory, official] =
            await Promise.all([
              fetchCompetitionRankHistory({
                competitionId: input.competitionId,
              }),
              loadHistoricalLeaderboardSnapshots(input.competitionId),
              loadCachedLeaderboard(input.competitionId),
            ]);
          const history = mergeCompetitionRankHistory(
            lakeHistory ?? [],
            authoritativeHistory,
          );
          return await analyzeCompetition({
            prisma,
            competition,
            mode: input.mode,
            preset: input.preset,
            startDate,
            endDate,
            history,
            official,
            now,
          });
        });
      } catch (error) {
        asBadRequest(error);
      }
    }),

  setAnalysisTimezone: guildMutationProcedure("competitions", "update")
    .input(CompetitionTimezoneInputSchema)
    .mutation(async ({ input }) => {
      await loadCompetitionOr404(input.competitionId, input.guildId);
      return prisma.competition.update({
        where: { id: input.competitionId },
        data: { analysisTimezone: input.timezone, updatedTime: new Date() },
      });
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
