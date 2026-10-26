import { readableRelationalDareContract } from "#src/dares/dare-common.ts";
import {
  matchTouchesRelationalDare,
  relationalDareMatchContext,
} from "#src/dares/evaluation/dare-match-eligibility.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { RawMatch } from "@scout-for-lol/data";

export async function dareMatchNeedsTimeline(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const context = relationalDareMatchContext(matchData);
  if (context === null) return false;
  const rows = await prismaClient.dare.findMany({
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
