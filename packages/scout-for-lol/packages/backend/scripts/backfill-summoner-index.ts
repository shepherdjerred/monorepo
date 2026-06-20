/**
 * Manual run of the SummonerIndex seed (it also runs automatically on backend
 * startup). Incremental + idempotent — inserts only PUUIDs not already indexed.
 *
 *   DATABASE_URL=... bun run scripts/backfill-summoner-index.ts
 */

import { backfillFromExisting } from "#src/lib/riot/summoner-index.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("backfill-summoner-index");

const result = await backfillFromExisting();
logger.info(
  `✅ Seeded summoner index: ${result.inserted.toString()} new of ${result.scanned.toString()} scanned.`,
);

await prisma.$disconnect();
process.exit(0);
