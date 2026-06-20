/**
 * One-off: seed the SummonerIndex from data we already have (resolved Accounts
 * + players seen in tracked games via PrematchParticipantFact). Idempotent —
 * safe to re-run; upserts by PUUID.
 *
 *   DATABASE_URL=... bun run scripts/backfill-summoner-index.ts
 */

import { backfillFromExisting } from "#src/lib/riot/summoner-index.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("backfill-summoner-index");

const result = await backfillFromExisting();
logger.info(
  `✅ Seeded summoner index: ${result.accounts.toString()} account(s), ${result.prematch.toString()} prematch participant(s).`,
);

await prisma.$disconnect();
process.exit(0);
