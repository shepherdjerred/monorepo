import { useParams } from "react-router";
import { z } from "zod";
import { CompetitionIdSchema, ReportIdSchema } from "@scout-for-lol/data";

/**
 * Zod schemas for the router-matched path params, plus hooks that
 * `.parse(useParams())`. Because the router only mounts these components once
 * the segment matched, a parse failure is a broken-caller contract — it throws,
 * surfacing through the route's `errorElement` rather than being swallowed by a
 * `?? ""` fallback.
 */

export const GuildParamsSchema = z.object({ guildId: z.string().min(1) });

export const PlayerParamsSchema = z.object({
  guildId: z.string().min(1),
  alias: z.string().min(1),
});

export const CompetitionParamsSchema = z.object({
  guildId: z.string().min(1),
  competitionId: z.coerce.number().pipe(CompetitionIdSchema),
});

export const ReportParamsSchema = z.object({
  guildId: z.string().min(1),
  reportId: z.coerce.number().pipe(ReportIdSchema),
});

export function useGuildParams(): z.infer<typeof GuildParamsSchema> {
  return GuildParamsSchema.parse(useParams());
}

export function usePlayerParams(): z.infer<typeof PlayerParamsSchema> {
  return PlayerParamsSchema.parse(useParams());
}

export function useCompetitionParams(): z.infer<
  typeof CompetitionParamsSchema
> {
  return CompetitionParamsSchema.parse(useParams());
}

export function useReportParams(): z.infer<typeof ReportParamsSchema> {
  return ReportParamsSchema.parse(useParams());
}
