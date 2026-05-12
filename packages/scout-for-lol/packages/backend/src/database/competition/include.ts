import type { Prisma } from "#generated/prisma/client/index.js";

/**
 * Standard Prisma `include` for Competition reads that flow through
 * `parseCompetition()`. Loads the `season` relation so season-based
 * competitions can resolve their effective `startDate`/`endDate` from
 * the DB instead of from in-memory `SEASONS`.
 *
 * Use this everywhere instead of inline `{ include: { season: true } }`
 * so the relation shape stays in lock-step with `CompetitionWithSeason`
 * in `@scout-for-lol/data`.
 */
export const competitionWithSeasonInclude = {
  season: true,
} satisfies Prisma.CompetitionInclude;

export type CompetitionRowWithSeason = Prisma.CompetitionGetPayload<{
  include: typeof competitionWithSeasonInclude;
}>;
