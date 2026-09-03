import type { RawMatch } from "@scout-for-lol/data";
import {
  matchTouchesRelationalDare,
  relationalDareMatchContext,
} from "#src/betting/dare-match-eligibility.ts";
import { darePlanNeedsTimeline } from "#src/betting/dare-timeline-evidence-v2.ts";
import { readableRelationalDareContract } from "#src/betting/dare-v2-common.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export async function dareV2MatchNeedsTimeline(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const context = relationalDareMatchContext(matchData);
  if (context === null) return false;
  if (context.queue === "arena") return false;
  const rows = await prismaClient.bucksDareV2.findMany({
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
      (contract.version === 3
        ? contract.facts.physicalSources.some((source) =>
            source.startsWith("timeline_"),
          )
        : darePlanNeedsTimeline(contract.compiledPlan))
    );
  });
}
