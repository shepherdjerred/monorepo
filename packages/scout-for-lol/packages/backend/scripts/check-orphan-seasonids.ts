/**
 * Pre-deploy audit: fail if any Competition row has a `seasonId` that is
 * not present in `SEASONS` (and therefore would not exist in the `Season`
 * table after the FK migration in `add_competition_season_relation`).
 *
 * Run against prod (or a read replica) before applying the FK migration.
 * Non-zero exit blocks the deploy.
 *
 *   DATABASE_URL=file:./prod.db bun run scripts/check-orphan-seasonids.ts
 */

import { SEASONS } from "@scout-for-lol/data";
import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const prisma = new PrismaClient({
  adapter: new PrismaLibSql({
    url: Bun.env["DATABASE_URL"] ?? "file:./db.sqlite",
  }),
});

const knownIds = Object.keys(SEASONS);

const orphans = await prisma.competition.findMany({
  where: { seasonId: { not: null, notIn: knownIds } },
  select: { id: true, title: true, serverId: true, seasonId: true },
});

if (orphans.length > 0) {
  console.error(`❌ Found ${orphans.length.toString()} orphan seasonId(s):`);
  for (const o of orphans) {
    console.error(
      `  id=${o.id.toString()} title=${JSON.stringify(o.title)} server=${o.serverId} seasonId=${String(o.seasonId)}`,
    );
  }
  console.error("");
  console.error("Resolve each row before applying the FK migration:");
  console.error("  - delete the row if it's test data");
  console.error("  - reassign seasonId to a valid value if it was a typo");
  console.error("  - add the season to seasons.ts and run again if it is real");
  await prisma.$disconnect();
  process.exit(1);
}

console.log(
  `✓ No orphan seasonIds across ${knownIds.length.toString()} known seasons.`,
);
await prisma.$disconnect();
