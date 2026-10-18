import { z } from "zod";
import {
  GameResultSchema,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { evidenceRecoveryEnabled } from "./admission.ts";
import { registeredResultPuuids } from "./result-accounts.ts";

export const ReportScoreboardSchema = z.strictObject({
  version: z.literal(1),
  result: GameResultSchema,
  trackedPuuids: z.array(LeaguePuuidSchema).min(1),
});
export type ReportScoreboard = z.infer<typeof ReportScoreboardSchema>;

/** A frozen report artifact does not claim complete processing coverage. */
export async function readReportScoreboard(
  matchId: RiotMatchId,
  db: Db = prisma,
): Promise<ReportScoreboard | null> {
  if (!evidenceRecoveryEnabled()) return null;
  const row = await db.matchReportSnapshot.findUnique({
    where: { riotMatchId: matchId },
  });
  if (row === null) return null;
  const document = ReportScoreboardSchema.parse(row.document);
  if (document.result.matchId !== matchId)
    throw new Error("Report scoreboard identity drift");
  return document;
}

export async function freezeReportScoreboard(
  matchId: RiotMatchId,
  result: GameResult,
): Promise<ReportScoreboard | null> {
  if (!evidenceRecoveryEnabled()) return null;
  if (result.matchId !== matchId)
    throw new Error("Cannot freeze a report for another match");
  const trackedPuuids = await registeredResultPuuids(result);
  if (trackedPuuids.length === 0) return null;
  const document = ReportScoreboardSchema.parse({
    version: 1,
    result,
    trackedPuuids,
  });
  const row = await prisma.matchReportSnapshot.upsert({
    where: { riotMatchId: matchId },
    create: { riotMatchId: matchId, document },
    update: {},
  });
  return ReportScoreboardSchema.parse(row.document);
}
