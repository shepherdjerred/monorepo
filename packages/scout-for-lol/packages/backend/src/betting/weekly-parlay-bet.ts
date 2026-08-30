import {
  BucksParlaySideSchema,
  BucksStakeSchema,
  type BucksParlaySide,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  ensureBucksAccount,
  findEligiblePlayer,
  HouseInsufficientError as WalletHouseInsufficientError,
} from "#src/betting/accounts.ts";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import {
  applyBucksDelta,
  BucksStorageOverflowError,
  InsufficientBucksError,
} from "#src/betting/ledger.ts";
import { addInt32, quoteParlayPosition } from "#src/betting/parlay-odds.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  bettingWeeklyParlayBetCancellationsTotal,
  bettingWeeklyParlayBetPlacementsTotal,
} from "#src/metrics/betting-weekly-parlay.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

export type PlaceWeeklyParlayBetResult =
  | {
      kind: "placed";
      side: BucksParlaySide;
      totalStake: number;
      grossPayout: number;
      balanceAfter: number;
      wasTopUp: boolean;
    }
  | { kind: "window_closed" | "no_market" | "feature_disabled" }
  | { kind: "not_eligible" | "invalid_stake" | "storage_limit" }
  | { kind: "insufficient"; balance: number; needed: number }
  | { kind: "wallet_house_insufficient" | "house_insufficient" }
  | { kind: "side_conflict"; existingSide: BucksParlaySide };

class WeeklyHouseInsufficientError extends Error {
  constructor() {
    super("The Bryan Bucks house cannot reserve this weekly liability");
    this.name = "WeeklyHouseInsufficientError";
  }
}

async function placeWeeklyParlayBetInternal(
  input: {
    marketId: number;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    side: BucksParlaySide;
    stake: number;
    now?: Date;
    surface?: "button" | "command" | "web";
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PlaceWeeklyParlayBetResult> {
  const [bettingEnabled, weeklyEnabled] = await Promise.all([
    isPolicyEnabled("betting_enabled", { server: input.serverId }),
    isPolicyEnabled("weekly_parlays_enabled", { server: input.serverId }),
  ]);
  if (!bettingEnabled || !weeklyEnabled) {
    return { kind: "feature_disabled" };
  }
  const stake = BucksStakeSchema.safeParse(input.stake);
  const side = BucksParlaySideSchema.safeParse(input.side);
  if (!stake.success || !side.success) {
    return { kind: "invalid_stake" };
  }
  const market = await prismaClient.bucksWeeklyParlayMarket.findFirst({
    where: { id: input.marketId, serverId: input.serverId },
    select: {
      id: true,
      periodKey: true,
      slot: true,
      definition: { select: { id: true, yesProbabilityBps: true } },
    },
  });
  if (market === null) {
    return { kind: "no_market" };
  }
  const player = await findEligiblePlayer(
    { serverId: input.serverId, discordId: input.discordId },
    prismaClient,
  );
  if (player === undefined) {
    return { kind: "not_eligible" };
  }
  let account: Awaited<ReturnType<typeof ensureBucksAccount>>;
  try {
    account = await ensureBucksAccount(
      { serverId: input.serverId, discordId: input.discordId },
      prismaClient,
    );
  } catch (error) {
    if (error instanceof WalletHouseInsufficientError) {
      return { kind: "wallet_house_insufficient" };
    }
    throw error;
  }

  try {
    return await prismaClient.$transaction(async (tx) => {
      const now = input.now ?? new Date();
      // FIRST write: guarded closure check and market-row lock.
      const claim = await tx.bucksWeeklyParlayMarket.updateMany({
        where: {
          id: market.id,
          marketState: "open",
          bettingClosesAt: { gt: now },
        },
        data: { updatedAt: now },
      });
      if (claim.count !== 1) {
        return { kind: "window_closed" };
      }
      const existing = await tx.bucksWeeklyParlayBet.findUnique({
        where: {
          marketId_bucksAccountId: {
            marketId: market.id,
            bucksAccountId: account.id,
          },
        },
        select: { id: true, side: true, stake: true, houseReserve: true },
      });
      if (existing !== null) {
        const existingSide = BucksParlaySideSchema.parse(existing.side);
        if (existingSide !== side.data) {
          return { kind: "side_conflict", existingSide };
        }
      }
      const totalStake = addInt32(existing?.stake ?? 0, stake.data);
      if (totalStake === undefined) {
        return { kind: "storage_limit" };
      }
      const quote = quoteParlayPosition({
        totalStake,
        yesProbabilityBps: market.definition.yesProbabilityBps,
        side: side.data,
      });
      if (quote === undefined) {
        return { kind: "storage_limit" };
      }
      const additionalReserve =
        quote.houseReserve - (existing?.houseReserve ?? 0);
      if (additionalReserve < 0) {
        throw new Error("A weekly top-up reduced reserved liability.");
      }
      const house = await ensureHouseAccountInTransaction(tx, input.serverId);
      const bet =
        existing === null
          ? await tx.bucksWeeklyParlayBet.create({
              data: {
                marketId: market.id,
                bucksAccountId: account.id,
                side: side.data,
                stake: stake.data,
                houseReserve: quote.houseReserve,
                grossPayout: quote.grossPayout,
              },
              select: { id: true },
            })
          : await tx.bucksWeeklyParlayBet.update({
              where: { id: existing.id },
              data: {
                stake: totalStake,
                houseReserve: quote.houseReserve,
                grossPayout: quote.grossPayout,
              },
              select: { id: true },
            });
      const balanceAfter = await applyBucksDelta(tx, {
        bucksAccountId: account.id,
        delta: -stake.data,
        kind: "weekly_parlay_stake",
        weeklyParlayBetId: bet.id,
        context: {
          type: "weekly_parlay_stake",
          version: 1,
          definitionId: market.definition.id,
          periodKey: market.periodKey,
          slot: market.slot,
          side: side.data,
          yesProbabilityBps: market.definition.yesProbabilityBps,
          totalStake,
          quotedGrossPayout: quote.grossPayout,
        },
      });
      if (additionalReserve > 0) {
        try {
          await applyBucksDelta(tx, {
            bucksAccountId: house.id,
            delta: -additionalReserve,
            kind: "weekly_parlay_reserve",
            weeklyParlayBetId: bet.id,
            context: {
              type: "weekly_parlay_reserve",
              version: 1,
              definitionId: market.definition.id,
              periodKey: market.periodKey,
              slot: market.slot,
              side: side.data,
              yesProbabilityBps: market.definition.yesProbabilityBps,
              totalStake,
              totalReserve: quote.houseReserve,
              quotedGrossPayout: quote.grossPayout,
            },
          });
        } catch (error) {
          if (error instanceof InsufficientBucksError) {
            throw new WeeklyHouseInsufficientError();
          }
          throw error;
        }
      }
      return {
        kind: "placed",
        side: side.data,
        totalStake,
        grossPayout: quote.grossPayout,
        balanceAfter,
        wasTopUp: existing !== null,
      };
    });
  } catch (error) {
    if (error instanceof WeeklyHouseInsufficientError) {
      return { kind: "house_insufficient" };
    }
    if (error instanceof InsufficientBucksError) {
      const current = await prismaClient.bucksAccount.findUnique({
        where: { id: account.id },
        select: { balance: true },
      });
      return {
        kind: "insufficient",
        balance: current?.balance ?? 0,
        needed: stake.data,
      };
    }
    if (error instanceof BucksStorageOverflowError) {
      return { kind: "storage_limit" };
    }
    throw error;
  }
}

export async function placeWeeklyParlayBet(
  input: {
    marketId: number;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    side: BucksParlaySide;
    stake: number;
    now?: Date;
    surface?: "button" | "command" | "web";
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PlaceWeeklyParlayBetResult> {
  const result = await placeWeeklyParlayBetInternal(input, prismaClient);
  if (result.kind === "placed") {
    const transition = result.wasTopUp ? "topped_up" : "placed";
    bettingWeeklyParlayBetPlacementsTotal.inc({ result: transition });
    logBucksTransition({
      event: result.wasTopUp
        ? "bucks.weekly_parlay_bet.topped_up"
        : "bucks.weekly_parlay_bet.placed",
      serverId: input.serverId,
      marketId: input.marketId,
      actorDiscordId: input.discordId,
      side: result.side,
      stake: result.totalStake,
      grossPayout: result.grossPayout,
      balanceAfter: result.balanceAfter,
      surface: input.surface ?? "button",
    });
  }
  return result;
}

export type CancelWeeklyParlayBetResult =
  | { kind: "cancelled"; refunded: number; balanceAfter: number }
  | { kind: "no_market" | "no_bet" | "window_closed" }
  | { kind: "already_resolved"; marketState: "settled" | "voided" };

async function cancelWeeklyParlayBetInternal(
  input: {
    marketId: number;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    now?: Date;
    surface?: "button" | "command" | "web";
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<CancelWeeklyParlayBetResult> {
  const market = await prismaClient.bucksWeeklyParlayMarket.findFirst({
    where: { id: input.marketId, serverId: input.serverId },
    select: {
      id: true,
      periodKey: true,
      slot: true,
      definition: { select: { id: true } },
    },
  });
  if (market === null) {
    return { kind: "no_market" };
  }
  const account = await prismaClient.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    select: { id: true },
  });
  if (account === null) {
    return { kind: "no_bet" };
  }
  const now = input.now ?? new Date();
  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksWeeklyParlayMarket.updateMany({
      where: {
        id: market.id,
        marketState: "open",
        bettingClosesAt: { gt: now },
      },
      data: { updatedAt: now },
    });
    if (claim.count !== 1) {
      const current = await tx.bucksWeeklyParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
        select: { marketState: true },
      });
      if (
        current.marketState === "settled" ||
        current.marketState === "voided"
      ) {
        return { kind: "already_resolved", marketState: current.marketState };
      }
      return { kind: "window_closed" };
    }
    const bet = await tx.bucksWeeklyParlayBet.findUnique({
      where: {
        marketId_bucksAccountId: {
          marketId: market.id,
          bucksAccountId: account.id,
        },
      },
      select: {
        id: true,
        side: true,
        stake: true,
        houseReserve: true,
        grossPayout: true,
      },
    });
    if (bet === null) {
      return { kind: "no_bet" };
    }
    const side = BucksParlaySideSchema.parse(bet.side);
    const house = await ensureHouseAccountInTransaction(tx, input.serverId);
    await tx.bucksWeeklyParlayBet.update({
      where: { id: bet.id },
      data: { betOutcome: "refunded", payout: bet.stake, settledAt: now },
    });
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
    const balanceAfter = await applyBucksDelta(tx, {
      bucksAccountId: account.id,
      delta: bet.stake,
      kind: "weekly_parlay_refund",
      weeklyParlayBetId: bet.id,
      context: { ...contextBase, credited: bet.stake },
    });
    await applyBucksDelta(tx, {
      bucksAccountId: house.id,
      delta: bet.houseReserve,
      kind: "weekly_parlay_release",
      weeklyParlayBetId: bet.id,
      context: { ...contextBase, credited: bet.houseReserve },
    });
    await tx.bucksWeeklyParlayBet.delete({ where: { id: bet.id } });
    return { kind: "cancelled", refunded: bet.stake, balanceAfter };
  });
}

export async function cancelWeeklyParlayBet(
  input: {
    marketId: number;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    now?: Date;
    surface?: "button" | "command" | "web";
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<CancelWeeklyParlayBetResult> {
  const result = await cancelWeeklyParlayBetInternal(input, prismaClient);
  if (result.kind === "cancelled") {
    bettingWeeklyParlayBetCancellationsTotal.inc();
    logBucksTransition({
      event: "bucks.weekly_parlay_bet.cancelled",
      serverId: input.serverId,
      marketId: input.marketId,
      actorDiscordId: input.discordId,
      stake: result.refunded,
      balanceAfter: result.balanceAfter,
      surface: input.surface ?? "button",
    });
  }
  return result;
}
