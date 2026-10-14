import type { RawMatch } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { writeMatchStagingFile } from "#src/report-lake/staging.ts";

/** Effect-query fixtures explicitly represent games admitted while live. */
export async function writeEligibleMatchStagingFile(
  db: ExtendedPrismaClient,
  lakeDir: string,
  match: RawMatch,
): Promise<boolean> {
  await db.matchEvidenceAdmission.upsert({
    where: { riotMatchId: match.metadata.matchId },
    create: {
      riotMatchId: match.metadata.matchId,
      policy: "FULL",
      reason: "live-completion",
      firstDiscoveredAt: new Date(match.info.gameEndTimestamp),
      completedAt: new Date(match.info.gameEndTimestamp),
      riotHistoryListed: true,
    },
    update: {},
  });
  return await writeMatchStagingFile(lakeDir, match);
}
