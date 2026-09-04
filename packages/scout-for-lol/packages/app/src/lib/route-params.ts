import { useParams } from "react-router";
import { z } from "zod";
import {
  CompetitionIdSchema,
  ChampionIdSchema,
  ExploreConversationIdSchema,
  MatchIdSchema,
  PlayerIdSchema,
  ReportIdSchema,
} from "@scout-for-lol/data";

/**
 * Zod schemas for the router-matched path params, plus hooks that
 * validate `useParams()`. Because the router only mounts these components once
 * the segment matched, a parse failure throws a dedicated
 * {@link RouteParameterError}, surfacing through the route's `errorElement`
 * rather than being swallowed by a `?? ""` fallback.
 */

export const GuildParamsSchema = z.object({ guildId: z.string().min(1) });

export const PlayerParamsSchema = z.object({
  guildId: z.string().min(1),
  alias: z.string().min(1),
});

export const ConsumerPlayerParamsSchema = z.object({
  playerId: z.coerce.number().pipe(PlayerIdSchema),
});

export const ConsumerChampionParamsSchema = z.object({
  championId: z.coerce.number().pipe(ChampionIdSchema),
});

export const ConsumerMatchParamsSchema = z.object({
  playerId: z.coerce.number().pipe(PlayerIdSchema),
  matchId: MatchIdSchema,
});

export const CompetitionParamsSchema = z.object({
  guildId: z.string().min(1),
  competitionId: z.coerce.number().pipe(CompetitionIdSchema),
});

export const ReportParamsSchema = z.object({
  guildId: z.string().min(1),
  reportId: z.coerce.number().pipe(ReportIdSchema),
});

/** The segment is optional — `/explore` is the not-yet-created conversation. */
export const ExploreParamsSchema = z.object({
  conversationId: ExploreConversationIdSchema.optional(),
});

export const HallParamsSchema = z.object({ guildId: z.string().min(1) });
export const ChallengeTemplateParamsSchema = z.object({
  templateId: z.uuid(),
});
export const ChallengeDraftParamsSchema = z.object({ draftId: z.uuid() });
export const ChallengeRunParamsSchema = z.object({ runId: z.uuid() });
export const DuelGuildParamsSchema = z.object({ guildId: z.string().min(1) });
export const DuelEventParamsSchema = z.object({
  guildId: z.string().min(1),
  eventId: z.uuid(),
});
export const DuelSeriesParamsSchema = z.object({
  guildId: z.string().min(1),
  seriesId: z.uuid(),
});

/**
 * Marks validation failures that came specifically from parsing matched URL
 * parameters. The route error boundary suppresses these expected boundary
 * failures while still reporting unrelated Zod contract violations.
 */
export class RouteParameterError extends Error {
  constructor(cause: z.ZodError) {
    super("The URL contains invalid route parameters.", { cause });
    this.name = "RouteParameterError";
  }
}

function parseRouteParams<TSchema extends z.ZodType>(
  schema: TSchema,
  params: unknown,
): z.output<TSchema> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new RouteParameterError(parsed.error);
  }
  return parsed.data;
}

export function useGuildParams(): z.infer<typeof GuildParamsSchema> {
  return parseRouteParams(GuildParamsSchema, useParams());
}

export function usePlayerParams(): z.infer<typeof PlayerParamsSchema> {
  return parseRouteParams(PlayerParamsSchema, useParams());
}

export function useConsumerPlayerParams(): z.infer<
  typeof ConsumerPlayerParamsSchema
> {
  return parseRouteParams(ConsumerPlayerParamsSchema, useParams());
}

export function useConsumerChampionParams(): z.infer<
  typeof ConsumerChampionParamsSchema
> {
  return parseRouteParams(ConsumerChampionParamsSchema, useParams());
}

export function useConsumerMatchParams(): z.infer<
  typeof ConsumerMatchParamsSchema
> {
  return parseRouteParams(ConsumerMatchParamsSchema, useParams());
}

export function useCompetitionParams(): z.infer<
  typeof CompetitionParamsSchema
> {
  return parseRouteParams(CompetitionParamsSchema, useParams());
}

export function useReportParams(): z.infer<typeof ReportParamsSchema> {
  return parseRouteParams(ReportParamsSchema, useParams());
}

export function useExploreParams(): z.infer<typeof ExploreParamsSchema> {
  return parseRouteParams(ExploreParamsSchema, useParams());
}

export function useHallParams(): z.infer<typeof HallParamsSchema> {
  return parseRouteParams(HallParamsSchema, useParams());
}

export function useChallengeTemplateParams(): z.infer<
  typeof ChallengeTemplateParamsSchema
> {
  return parseRouteParams(ChallengeTemplateParamsSchema, useParams());
}

export function useChallengeDraftParams(): z.infer<
  typeof ChallengeDraftParamsSchema
> {
  return parseRouteParams(ChallengeDraftParamsSchema, useParams());
}

export function useChallengeRunParams(): z.infer<
  typeof ChallengeRunParamsSchema
> {
  return parseRouteParams(ChallengeRunParamsSchema, useParams());
}

export function useDuelGuildParams(): z.infer<typeof DuelGuildParamsSchema> {
  return parseRouteParams(DuelGuildParamsSchema, useParams());
}

export function useDuelEventParams(): z.infer<typeof DuelEventParamsSchema> {
  return parseRouteParams(DuelEventParamsSchema, useParams());
}

export function useDuelSeriesParams(): z.infer<typeof DuelSeriesParamsSchema> {
  return parseRouteParams(DuelSeriesParamsSchema, useParams());
}
