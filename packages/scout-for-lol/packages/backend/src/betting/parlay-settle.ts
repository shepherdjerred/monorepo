import * as Sentry from "@sentry/bun";
import {
  BUCKS_INT32_MAX,
  BucksMessageRefsSchema,
  BucksParlaySideSchema,
  BucksParlayVoidReasonSchema,
  type BucksParlaySide,
  type BucksParlayVoidReason,
  type DiscordGuildId,
  type RawMatch,
} from "@scout-for-lol/data";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import {
  applyBucksDelta,
  refundableBucksHeldForAccounts,
} from "#src/betting/ledger.ts";
import {
  evaluateParlay,
  ParlayLegResultsSchema,
  type ParlayLegResult,
} from "#src/betting/parlay-evaluator.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { Db } from "#src/lib/audit/index.ts";
import { bettingParlayVoidsTotal } from "#src/metrics/betting-parlay.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-parlay-settle");

export type ParlaySettlementBet = {
  discordId: string;
  side: BucksParlaySide;
  stake: number;
  grossPayout: number;
  payout: number;
  outcome: "won" | "lost" | "refunded";
};

export type ParlaySettlementSummary = {
  matchId: string;
  serverId: string;
  yesResult: boolean | undefined;
  voidReason: BucksParlayVoidReason | undefined;
  legs: ParlayLegResult[];
  messageRefs: { channelId: string; messageId: string }[];
  bets: ParlaySettlementBet[];
};

function creditFits(balance: number, credit: bigint, held: bigint): boolean {
  return (
    held >= 0n && BigInt(balance) + credit + held <= BigInt(BUCKS_INT32_MAX)
  );
}

type PendingParlayBet = {
  id: number;
  bucksAccountId: number;
  side: string;
  stake: number;
  houseReserve: number;
  grossPayout: number;
  bucksAccount: {
    discordId: string;
    serverId: string;
    isHouse: boolean;
    balance: number;
  };
  refundableHeld: bigint;
};

type PlannedPosition = {
  bet: PendingParlayBet;
  outcome: "won" | "lost" | "refunded";
  payout: number;
};

type SettlementEvaluation = ReturnType<typeof evaluateParlay>;

function settlementPlan(
  evaluation: SettlementEvaluation,
  bets: readonly PendingParlayBet[],
  houseBalance: number,
  houseRefundableHeld: bigint,
): {
  winningSide: BucksParlaySide | undefined;
  voidReason: BucksParlayVoidReason | undefined;
  houseRefundableHeldAfterSettlement: bigint;
} {
  const winningSide =
    evaluation.kind === "evaluated"
      ? evaluation.yesResult
        ? "YES"
        : "NO"
      : undefined;
  const held = bets.reduce(
    (total, bet) => total + BigInt(bet.stake) + BigInt(bet.houseReserve),
    0n,
  );
  let winningCredits = 0n;
  let houseCredit = 0n;
  let releasedHouseReserve = 0n;
  let invalidQuote = false;
  for (const bet of bets) {
    const side = BucksParlaySideSchema.parse(bet.side);
    const otherUserHeld = bet.refundableHeld - BigInt(bet.stake);
    releasedHouseReserve += BigInt(bet.houseReserve);
    if (bet.grossPayout !== bet.stake + bet.houseReserve) {
      invalidQuote = true;
    }
    if (
      !creditFits(bet.bucksAccount.balance, BigInt(bet.stake), otherUserHeld)
    ) {
      invalidQuote = true;
    }
    if (winningSide === side) {
      winningCredits += BigInt(bet.grossPayout);
      if (
        !creditFits(
          bet.bucksAccount.balance,
          BigInt(bet.grossPayout),
          otherUserHeld,
        )
      ) {
        invalidQuote = true;
      }
    } else if (winningSide !== undefined) {
      houseCredit += BigInt(bet.grossPayout);
    }
  }
  if (winningSide !== undefined && winningCredits + houseCredit !== held) {
    invalidQuote = true;
  }
  const otherHouseHeld = houseRefundableHeld - releasedHouseReserve;
  const houseSettlementCredit =
    winningSide === undefined ? releasedHouseReserve : houseCredit;
  if (!creditFits(houseBalance, houseSettlementCredit, otherHouseHeld)) {
    invalidQuote = true;
  }
  return {
    winningSide,
    houseRefundableHeldAfterSettlement: otherHouseHeld,
    voidReason:
      evaluation.kind === "void"
        ? evaluation.reason
        : invalidQuote
          ? "storage_overflow"
          : undefined,
  };
}

async function settlePosition(
  tx: Db,
  input: {
    position: PlannedPosition;
    houseId: number;
    houseRefundableHeldAfterSettlement: bigint;
    matchId: string;
    voidReason: BucksParlayVoidReason | undefined;
    yesResult: boolean | undefined;
  },
): Promise<ParlaySettlementBet> {
  const { bet, outcome, payout } = input.position;
  const side = BucksParlaySideSchema.parse(bet.side);
  const contextBase = {
    type: "parlay_settlement" as const,
    side,
    stake: bet.stake,
    reserve: bet.houseReserve,
    grossPayout: bet.grossPayout,
  };
  if (outcome === "refunded") {
    await applyBucksDelta(tx, {
      bucksAccountId: bet.bucksAccountId,
      delta: bet.stake,
      kind: "parlay_refund",
      matchId: input.matchId,
      parlayBetId: bet.id,
      context: {
        ...contextBase,
        credited: bet.stake,
        voidReason: input.voidReason,
      },
      knownRefundableHeld: bet.refundableHeld - BigInt(bet.stake),
    });
    await applyBucksDelta(tx, {
      bucksAccountId: input.houseId,
      delta: bet.houseReserve,
      kind: "parlay_release",
      matchId: input.matchId,
      parlayBetId: bet.id,
      context: {
        ...contextBase,
        credited: bet.houseReserve,
        voidReason: input.voidReason,
      },
      knownRefundableHeld: input.houseRefundableHeldAfterSettlement,
    });
    return {
      discordId: bet.bucksAccount.discordId,
      side,
      stake: bet.stake,
      grossPayout: bet.grossPayout,
      payout,
      outcome,
    };
  }

  const won = outcome === "won";
  await applyBucksDelta(tx, {
    bucksAccountId: won ? bet.bucksAccountId : input.houseId,
    delta: bet.grossPayout,
    kind: won ? "parlay_payout" : "parlay_release",
    matchId: input.matchId,
    parlayBetId: bet.id,
    context: {
      ...contextBase,
      yesResult: input.yesResult,
      credited: bet.grossPayout,
    },
    knownRefundableHeld: won
      ? bet.refundableHeld - BigInt(bet.stake)
      : input.houseRefundableHeldAfterSettlement,
  });
  return {
    discordId: bet.bucksAccount.discordId,
    side,
    stake: bet.stake,
    grossPayout: bet.grossPayout,
    payout,
    outcome,
  };
}

async function settleMarketTransaction(
  tx: Db,
  input: {
    market: {
      id: number;
      matchId: string;
      serverId: DiscordGuildId;
      messageRefs: string;
    };
    evaluation: SettlementEvaluation;
  },
): Promise<ParlaySettlementSummary | undefined> {
  const settledAt = new Date();
  const claim = await tx.bucksParlayMarket.updateMany({
    where: {
      id: input.market.id,
      marketState: { in: ["open", "closed"] },
    },
    data:
      input.evaluation.kind === "void"
        ? {
            marketState: "voided",
            voidReason: input.evaluation.reason,
            settledAt,
          }
        : {
            marketState: "settled",
            yesResult: input.evaluation.yesResult,
            legResults: JSON.stringify(input.evaluation.legs),
            settledAt,
          },
  });
  if (claim.count !== 1) return undefined;

  const pendingBets = await tx.bucksParlayBet.findMany({
    where: { marketId: input.market.id, betOutcome: "pending" },
    select: {
      id: true,
      bucksAccountId: true,
      side: true,
      stake: true,
      houseReserve: true,
      grossPayout: true,
      bucksAccount: {
        select: {
          discordId: true,
          serverId: true,
          isHouse: true,
          balance: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const house = await ensureHouseAccountInTransaction(
    tx,
    input.market.serverId,
  );
  const refundableByAccount = await refundableBucksHeldForAccounts(tx, [
    ...pendingBets.map((bet) => ({
      id: bet.bucksAccountId,
      serverId: bet.bucksAccount.serverId,
      isHouse: bet.bucksAccount.isHouse,
    })),
    { id: house.id, serverId: input.market.serverId, isHouse: true },
  ]);
  const bets = pendingBets.map((bet) => {
    const refundableHeld = refundableByAccount.get(bet.bucksAccountId);
    if (refundableHeld === undefined) {
      throw new Error(
        `Missing refundable holdings for Bucks account ${bet.bucksAccountId.toString()}`,
      );
    }
    return { ...bet, refundableHeld };
  });
  const houseRefundableHeld = refundableByAccount.get(house.id);
  if (houseRefundableHeld === undefined) {
    throw new Error(
      `Missing refundable holdings for house account ${house.id.toString()}`,
    );
  }
  const plan = settlementPlan(
    input.evaluation,
    bets,
    house.balance,
    houseRefundableHeld,
  );
  if (plan.voidReason !== undefined && input.evaluation.kind === "evaluated") {
    await tx.bucksParlayMarket.update({
      where: { id: input.market.id },
      data: {
        marketState: "voided",
        yesResult: null,
        voidReason: plan.voidReason,
        legResults: JSON.stringify(input.evaluation.legs),
      },
    });
  }
  const positions: PlannedPosition[] = bets.map((bet) => {
    if (plan.voidReason !== undefined) {
      return { bet, outcome: "refunded", payout: bet.stake };
    }
    const won = BucksParlaySideSchema.parse(bet.side) === plan.winningSide;
    return {
      bet,
      outcome: won ? "won" : "lost",
      payout: won ? bet.grossPayout : 0,
    };
  });
  // Release every current-market stake and reserve from the headroom invariant
  // before applying credits. Otherwise an early losing position can be refused
  // while a later position's soon-to-be-released reserve is still pending.
  for (const position of positions) {
    await tx.bucksParlayBet.update({
      where: { id: position.bet.id },
      data: {
        betOutcome: position.outcome,
        payout: position.payout,
        settledAt,
      },
    });
  }

  const settledBets: ParlaySettlementBet[] = [];
  for (const position of positions) {
    settledBets.push(
      await settlePosition(tx, {
        position,
        houseId: house.id,
        houseRefundableHeldAfterSettlement:
          plan.houseRefundableHeldAfterSettlement,
        matchId: input.market.matchId,
        voidReason: plan.voidReason,
        yesResult:
          input.evaluation.kind === "evaluated"
            ? input.evaluation.yesResult
            : undefined,
      }),
    );
  }
  return {
    matchId: input.market.matchId,
    serverId: input.market.serverId,
    yesResult:
      plan.voidReason === undefined && input.evaluation.kind === "evaluated"
        ? input.evaluation.yesResult
        : undefined,
    voidReason: BucksParlayVoidReasonSchema.optional().parse(plan.voidReason),
    legs:
      input.evaluation.kind === "evaluated"
        ? ParlayLegResultsSchema.parse(input.evaluation.legs)
        : [],
    messageRefs: BucksMessageRefsSchema.parse(
      JSON.parse(input.market.messageRefs),
    ).map((ref) => ({ ...ref })),
    bets: settledBets,
  };
}

export async function settleParlaysForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<ParlaySettlementSummary[]> {
  const matchId = matchData.metadata.matchId;
  const markets = await (async () => {
    try {
      return await prismaClient.bucksParlayMarket.findMany({
        where: { matchId, marketState: { in: ["open", "closed"] } },
        select: {
          id: true,
          matchId: true,
          serverId: true,
          messageRefs: true,
          definition: {
            select: {
              selectedTeamId: true,
              subjects: true,
              criteria: true,
              evaluatorVersion: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error(`Could not load Bryan Bucks parlays for ${matchId}:`, error);
      Sentry.captureException(error, {
        tags: { source: "betting-parlay-settle-load", matchId },
      });
      return [];
    }
  })();
  const summaries: ParlaySettlementSummary[] = [];

  for (const market of markets) {
    try {
      const evaluation = evaluateParlay({
        matchData,
        evaluatorVersion: market.definition.evaluatorVersion,
        selectedTeamId: market.definition.selectedTeamId,
        subjects: JSON.parse(market.definition.subjects),
        criteria: JSON.parse(market.definition.criteria),
      });
      const summary = await prismaClient.$transaction((tx) =>
        settleMarketTransaction(tx, { market, evaluation }),
      );
      if (summary !== undefined) {
        summaries.push(summary);
        logBucksTransition({
          event:
            summary.voidReason === undefined
              ? "bucks.parlay.settled"
              : "bucks.parlay.voided",
          matchId: summary.matchId,
          serverId: summary.serverId,
          fromState: "closed",
          toState: summary.voidReason === undefined ? "settled" : "voided",
          ...(summary.voidReason === undefined
            ? {}
            : { reason: summary.voidReason }),
          surface: "postmatch",
        });
        for (const bet of summary.bets) {
          logBucksTransition({
            event: "bucks.parlay_bet.settled",
            matchId: summary.matchId,
            serverId: summary.serverId,
            actorDiscordId: bet.discordId,
            side: bet.side,
            stake: bet.stake,
            grossPayout: bet.grossPayout,
            payout: bet.payout,
            reason: bet.outcome,
            surface: "postmatch",
          });
        }
        if (summary.voidReason !== undefined) {
          bettingParlayVoidsTotal.inc({ reason: summary.voidReason });
        }
      }
    } catch (error) {
      logger.error(
        `Could not settle Bryan Bucks parlay ${matchId} in guild ${market.serverId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-parlay-settle",
          matchId,
          serverId: market.serverId,
        },
      });
    }
  }
  return summaries;
}
