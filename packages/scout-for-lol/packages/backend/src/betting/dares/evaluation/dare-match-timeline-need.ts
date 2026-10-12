import type { RawMatch } from "@scout-for-lol/data";
import {
  matchTouchesRelationalDare,
  relationalDareMatchContext,
} from "#src/betting/dares/evaluation/dare-match-eligibility.ts";
import { readableRelationalDareContract } from "#src/betting/dares/dare-common.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export async function dareMatchNeedsTimeline(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const context = relationalDareMatchContext(matchData);
  if (context === null) return false;
  const rows = await prismaClient.bucksDare.findMany({
    where: {
      dareState: "active",
      activatedAt: { lt: context.gameStartAt },
      deadlineAt: { gte: context.gameEndAt },
    },
    select: { contractJson: true },
    orderBy: { id: "asc" },
  });
  return rows.some((row) => {
    const contract = readableRelationalDareContract(row.contractJson);
    return (
      contract !== null &&
      matchTouchesRelationalDare(matchData, contract) &&
      contract.facts.physicalSources.some((source) =>
        source.startsWith("timeline_"),
      )
    );
  });
}
