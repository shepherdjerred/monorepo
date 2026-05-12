import { SEASONS } from "@scout-for-lol/data";
import * as Sentry from "@sentry/bun";
import { type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("season-seeder");

/**
 * Upsert every entry in `SEASONS` (from `@scout-for-lol/data`) into the
 * `Season` table. Runs on bot startup so a `seasons.ts` edit (e.g., Riot
 * shifts an act end date) propagates to every season-based Competition via
 * the live FK join on the next read.
 *
 * Idempotent: re-running with no changes is a no-op semantically.
 */
export async function seedSeasons(
  prisma: ExtendedPrismaClient,
): Promise<{ upserted: number }> {
  let upserted = 0;
  try {
    for (const season of Object.values(SEASONS)) {
      await prisma.season.upsert({
        where: { id: season.id },
        update: {
          displayName: season.displayName,
          startDate: season.startDate,
          endDate: season.endDate,
        },
        create: {
          id: season.id,
          displayName: season.displayName,
          startDate: season.startDate,
          endDate: season.endDate,
        },
      });
      upserted++;
    }
    logger.info(`🌱 Seeded ${upserted.toString()} season(s)`);
    return { upserted };
  } catch (error) {
    logger.error("❌ Error seeding seasons:", error);
    Sentry.captureException(error, { tags: { source: "season-seeder" } });
    throw error;
  }
}
