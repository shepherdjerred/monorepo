import type { SeasonId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export type SeasonFilterTimes = {
  activeAt: Date;
  inactiveAt: Date;
};

/**
 * Returns deterministic instants immediately before and at a seeded season's
 * end. Deriving these from the test database keeps season-filter tests valid
 * when the canonical season metadata is corrected.
 */
export async function getSeasonFilterTimes(
  prisma: ExtendedPrismaClient,
  seasonId: SeasonId,
): Promise<SeasonFilterTimes> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    select: { endDate: true },
  });

  return {
    activeAt: new Date(season.endDate.getTime() - 1),
    inactiveAt: season.endDate,
  };
}
