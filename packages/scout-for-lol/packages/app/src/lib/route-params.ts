import { useParams } from "react-router";
import { z } from "zod";
import { CompetitionIdSchema, ReportIdSchema } from "@scout-for-lol/data";

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

export const CompetitionParamsSchema = z.object({
  guildId: z.string().min(1),
  competitionId: z.coerce.number().pipe(CompetitionIdSchema),
});

export const ReportParamsSchema = z.object({
  guildId: z.string().min(1),
  reportId: z.coerce.number().pipe(ReportIdSchema),
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

export function useCompetitionParams(): z.infer<
  typeof CompetitionParamsSchema
> {
  return parseRouteParams(CompetitionParamsSchema, useParams());
}

export function useReportParams(): z.infer<typeof ReportParamsSchema> {
  return parseRouteParams(ReportParamsSchema, useParams());
}
