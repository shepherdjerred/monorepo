import {
  BucksParlaySideSchema,
  BucksWeeklyParlayVoidReasonSchema,
  type BucksParlaySide,
  type BucksWeeklyParlayVoidReason,
} from "@scout-for-lol/data";
import { z } from "zod";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import {
  applyBucksDelta,
  BucksStorageOverflowError,
  refundableBucksHeldForAccounts,
} from "#src/betting/ledger.ts";
import {
  WEEKLY_PARLAY_EVALUATOR_VERSION,
  WeeklyParlayContributionSnapshotSchema,
  WeeklyParlayDefinitionCriteriaSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import { evaluateWeeklyParlay } from "#src/betting/weekly-parlay-evaluator.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  bettingWeeklyParlayBetSettlementsTotal,
  bettingWeeklyParlayMarketSettlementsTotal,
} from "#src/metrics/betting-weekly-parlay.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import { WEEKLY_PARLAY_INGESTION_GRACE_MS } from "#src/betting/weekly-parlay-period.ts";

export type WeeklyParlaySettlementMode = "early_yes" | "final" | "void";

export type WeeklyParlaySettlementSummary = {
  marketId: number;
  serverId: string;
  periodKey: string;
  definitionId: number;
  slot: number;
  fromState: string;
  yesResult: boolean | undefined;
  voidReason: BucksWeeklyParlayVoidReason | undefined;
  bettors: string[];
  betOutcomes: ("won" | "lost" | "refunded")[];
};

type SettlementDecision =
  | { kind: "result"; yesResult: boolean; legResults: string }
  | { kind: "void"; reason: BucksWeeklyParlayVoidReason };

type ParsedJson = { success: true; value: unknown } | { success: false };

function parseJson(value: string): ParsedJson {
  try {
    return { success: true, value: JSON.parse(value) };
  } catch {
    return { success: false };
  }
}

function decisionFor(input: {
  evaluatorVersion: string;
  criteria: string;
  snapshots: string[];
  mode: WeeklyParlaySettlementMode;
  voidReason?: BucksWeeklyParlayVoidReason | undefined;
}): SettlementDecision | undefined {
  if (input.mode === "void") {
    return {
      kind: "void",
      reason: BucksWeeklyParlayVoidReasonSchema.parse(input.voidReason),
    };
  }
  if (input.evaluatorVersion !== WEEKLY_PARLAY_EVALUATOR_VERSION) {
    return { kind: "void", reason: "unknown_evaluator" };
  }
  const parsedCriteria = parseJson(input.criteria);
  if (!parsedCriteria.success) {
    return { kind: "void", reason: "invalid_definition" };
  }
  const criteria = WeeklyParlayDefinitionCriteriaSchema.safeParse(
    parsedCriteria.value,
  );
  if (!criteria.success) {
    return { kind: "void", reason: "invalid_definition" };
  }
  const parsedSnapshots = input.snapshots.map((snapshot) =>
    parseJson(snapshot),
  );
  if (parsedSnapshots.some((snapshot) => !snapshot.success)) {
    return { kind: "void", reason: "missing_data" };
  }
  const contributions = z
    .array(WeeklyParlayContributionSnapshotSchema)
    .safeParse(
      parsedSnapshots.flatMap((snapshot) =>
        snapshot.success ? [snapshot.value] : [],
      ),
    );
  if (!contributions.success) {
    return { kind: "void", reason: "missing_data" };
  }
  let evaluation: ReturnType<typeof evaluateWeeklyParlay>;
  try {
    evaluation = evaluateWeeklyParlay(criteria.data, contributions.data);
  } catch {
    return { kind: "void", reason: "infrastructure_failure" };
  }
  if (input.mode === "early_yes" && !evaluation.irreversiblyYes) {
    return;
  }
  return {
    kind: "result",
    yesResult: evaluation.yesResult,
    legResults: JSON.stringify(evaluation.legs),
  };
}

function claimableStates(mode: WeeklyParlaySettlementMode): string[] {
  switch (mode) {
    case "void":
      return ["publishing", "open", "active"];
    case "early_yes":
      return ["active"];
    case "final":
      return ["publishing", "open", "active"];
  }
}

function settlementSummary(
  market: {
    id: number;
    serverId: string;
    periodKey: string;
    slot: number;
    marketState: string;
    definition: { id: number };
  },
  decision: SettlementDecision,
  bettors: string[],
  betOutcomes: ("won" | "lost" | "refunded")[],
): WeeklyParlaySettlementSummary {
  return {
    marketId: market.id,
    serverId: market.serverId,
    periodKey: market.periodKey,
    definitionId: market.definition.id,
    slot: market.slot,
    fromState: market.marketState,
    yesResult: decision.kind === "result" ? decision.yesResult : undefined,
    voidReason: decision.kind === "void" ? decision.reason : undefined,
    bettors,
    betOutcomes,
  };
}

function observeSettlement(
  summary: WeeklyParlaySettlementSummary,
  surface: "postmatch" | "cron",
): void {
  const marketResult =
    summary.voidReason === undefined
      ? summary.yesResult === true
        ? "yes"
        : "no"
      : "voided";
  bettingWeeklyParlayMarketSettlementsTotal.inc({ result: marketResult });
  logBucksTransition({
    event:
      summary.voidReason === undefined
        ? "bucks.weekly_parlay.settled"
        : "bucks.weekly_parlay.voided",
    serverId: summary.serverId,
    marketId: summary.marketId,
    definitionId: summary.definitionId,
    periodKey: summary.periodKey,
    slot: summary.slot,
    fromState: summary.fromState,
    toState: summary.voidReason === undefined ? "settled" : "voided",
    ...(summary.voidReason === undefined ? {} : { reason: summary.voidReason }),
    surface,
  });
  for (const [index, outcome] of summary.betOutcomes.entries()) {
    bettingWeeklyParlayBetSettlementsTotal.inc({ result: outcome });
    const actorDiscordId = summary.bettors[index];
    logBucksTransition({
      event: "bucks.weekly_parlay_bet.settled",
      serverId: summary.serverId,
      marketId: summary.marketId,
      definitionId: summary.definitionId,
      periodKey: summary.periodKey,
      slot: summary.slot,
      ...(actorDiscordId === undefined ? {} : { actorDiscordId }),
      reason: outcome,
      surface,
    });
  }
}

export async function settleWeeklyParlayMarket(
  input: {
    marketId: number;
    mode: WeeklyParlaySettlementMode;
    voidReason?: BucksWeeklyParlayVoidReason;
    now?: Date;
    surface?: "postmatch" | "cron";
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<WeeklyParlaySettlementSummary | undefined> {
  const now = input.now ?? new Date();
  // The workflow begins final reconciliation at the scoring cutoff. Keep the
  // market claimable by post-match ingestion for two worst-case polling
  // windows so a game that completed just before the cutoff can reach Match-V5.
  const latestFinalizableScoringEnd = new Date(
    now.getTime() - WEEKLY_PARLAY_INGESTION_GRACE_MS,
  );
  try {
    const summary = await prismaClient.$transaction(async (tx) => {
      // FIRST write: lock the same market row contribution ingestion locks. A
      // finalizer therefore sees every contribution whose append won the row
      // before it, and no contribution can slip in after the evaluation read.
      const claim = await tx.bucksWeeklyParlayMarket.updateMany({
        where: {
          id: input.marketId,
          marketState: { in: claimableStates(input.mode) },
          ...(input.mode === "final"
            ? { scoringEndsAt: { lte: latestFinalizableScoringEnd } }
            : {}),
        },
        data: { updatedAt: now },
      });
      if (claim.count !== 1) {
        return;
      }

      const market = await tx.bucksWeeklyParlayMarket.findUniqueOrThrow({
        where: { id: input.marketId },
        select: {
          id: true,
          serverId: true,
          periodKey: true,
          slot: true,
          marketState: true,
          definition: {
            select: {
              id: true,
              criteria: true,
              evaluatorVersion: true,
              contributions: { select: { snapshot: true } },
            },
          },
        },
      });
      const decision: SettlementDecision | undefined =
        input.mode === "final" &&
        (market.marketState === "publishing" || market.marketState === "open")
          ? { kind: "void", reason: "infrastructure_failure" }
          : decisionFor({
              evaluatorVersion: market.definition.evaluatorVersion,
              criteria: market.definition.criteria,
              snapshots: market.definition.contributions.map(
                (contribution) => contribution.snapshot,
              ),
              mode: input.mode,
              voidReason: input.voidReason,
            });
      if (decision === undefined) {
        return;
      }
      await tx.bucksWeeklyParlayMarket.update({
        where: { id: market.id },
        data:
          decision.kind === "void"
            ? {
                marketState: "voided",
                voidReason: decision.reason,
                settledAt: now,
              }
            : {
                marketState: "settled",
                yesResult: decision.yesResult,
                legResults: decision.legResults,
                settledAt: now,
              },
      });

      const bets = await tx.bucksWeeklyParlayBet.findMany({
        where: { marketId: market.id, betOutcome: "pending" },
        select: {
          id: true,
          bucksAccountId: true,
          side: true,
          stake: true,
          houseReserve: true,
          grossPayout: true,
          bucksAccount: {
            select: { discordId: true, serverId: true, isHouse: true },
          },
        },
        orderBy: { id: "asc" },
      });
      if (bets.length === 0) {
        return settlementSummary(market, decision, [], []);
      }
      const house = await ensureHouseAccountInTransaction(tx, market.serverId);
      const held = await refundableBucksHeldForAccounts(tx, [
        ...bets.map((bet) => ({
          id: bet.bucksAccountId,
          serverId: bet.bucksAccount.serverId,
          isHouse: bet.bucksAccount.isHouse,
        })),
        { id: house.id, serverId: market.serverId, isHouse: true },
      ]);
      const remainingHeld = new Map(held);
      const bettorIds: string[] = [];
      const betOutcomes: ("won" | "lost" | "refunded")[] = [];
      for (const bet of bets) {
        const side = BucksParlaySideSchema.parse(bet.side);
        const userHeld = remainingHeld.get(bet.bucksAccountId);
        const houseHeld = remainingHeld.get(house.id);
        if (userHeld === undefined || houseHeld === undefined) {
          throw new Error("Missing refundable weekly parlay holdings.");
        }
        const userHeldAfter = userHeld - BigInt(bet.stake);
        const houseHeldAfter = houseHeld - BigInt(bet.houseReserve);
        remainingHeld.set(bet.bucksAccountId, userHeldAfter);
        remainingHeld.set(house.id, houseHeldAfter);
        const contextBase = {
          type: "weekly_parlay_settlement" as const,
          version: 1 as const,
          definitionId: market.definition.id,
          periodKey: market.periodKey,
          slot: market.slot,
          side,
          stake: bet.stake,
          reserve: bet.houseReserve,
          grossPayout: bet.grossPayout,
        };
        if (decision.kind === "void") {
          await applyBucksDelta(tx, {
            bucksAccountId: bet.bucksAccountId,
            delta: bet.stake,
            kind: "weekly_parlay_refund",
            weeklyParlayBetId: bet.id,
            context: {
              ...contextBase,
              credited: bet.stake,
              voidReason: decision.reason,
            },
            knownRefundableHeld: userHeldAfter,
          });
          await applyBucksDelta(tx, {
            bucksAccountId: house.id,
            delta: bet.houseReserve,
            kind: "weekly_parlay_release",
            weeklyParlayBetId: bet.id,
            context: {
              ...contextBase,
              credited: bet.houseReserve,
              voidReason: decision.reason,
            },
            knownRefundableHeld: houseHeldAfter,
          });
          await tx.bucksWeeklyParlayBet.update({
            where: { id: bet.id },
            data: { betOutcome: "refunded", payout: bet.stake, settledAt: now },
          });
          betOutcomes.push("refunded");
        } else {
          const winningSide: BucksParlaySide = decision.yesResult
            ? "YES"
            : "NO";
          const won = side === winningSide;
          await applyBucksDelta(tx, {
            bucksAccountId: won ? bet.bucksAccountId : house.id,
            delta: bet.grossPayout,
            kind: won ? "weekly_parlay_payout" : "weekly_parlay_release",
            weeklyParlayBetId: bet.id,
            context: {
              ...contextBase,
              yesResult: decision.yesResult,
              credited: bet.grossPayout,
            },
            knownRefundableHeld: won ? userHeldAfter : houseHeldAfter,
          });
          await tx.bucksWeeklyParlayBet.update({
            where: { id: bet.id },
            data: {
              betOutcome: won ? "won" : "lost",
              payout: won ? bet.grossPayout : 0,
              settledAt: now,
            },
          });
          betOutcomes.push(won ? "won" : "lost");
        }
        bettorIds.push(bet.bucksAccount.discordId);
      }
      return settlementSummary(market, decision, bettorIds, betOutcomes);
    });
    if (summary !== undefined) {
      observeSettlement(summary, input.surface ?? "cron");
    }
    return summary;
  } catch (error) {
    if (error instanceof BucksStorageOverflowError && input.mode !== "void") {
      return await settleWeeklyParlayMarket(
        {
          marketId: input.marketId,
          mode: "void",
          voidReason: "storage_overflow",
          now,
          ...(input.surface === undefined ? {} : { surface: input.surface }),
        },
        prismaClient,
      );
    }
    throw error;
  }
}
