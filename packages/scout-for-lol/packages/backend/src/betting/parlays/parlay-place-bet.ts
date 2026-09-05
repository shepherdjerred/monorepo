import {
  BucksParlaySideSchema,
  BucksStakeSchema,
  BucksPoolRosterSchema,
  type BucksParlaySide,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  ensureBucksAccount,
  HouseInsufficientError as WalletHouseInsufficientError,
  findEligiblePlayer,
} from "#src/betting/accounts.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import { GeneratedParlaySchema } from "#src/betting/parlays/parlay-criteria.ts";
import {
  applyBucksDelta,
  BucksStorageOverflowError,
  InsufficientBucksError,
} from "#src/betting/ledger.ts";
import {
  addInt32,
  quoteParlayPosition,
} from "#src/betting/parlays/parlay-odds.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  bettingOversizedStakeRejectedTotal,
  bettingParlayBetPlacementsTotal,
  bettingParlayHouseBalance,
  bettingParlayHouseUnavailableTotal,
} from "#src/metrics/betting-parlay.ts";
import { createLogger } from "#src/logger.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

const logger = createLogger("betting-parlay-place-bet");

export type PlaceParlayBetResult =
  | {
      kind: "placed";
      side: BucksParlaySide;
      totalStake: number;
      grossPayout: number;
      balanceAfter: number;
      /** True when this call added to an already-open position. */
      wasTopUp: boolean;
    }
  | { kind: "window_closed" }
  | { kind: "no_market" }
  | { kind: "feature_disabled" }
  | { kind: "not_eligible" }
  | { kind: "invalid_stake" }
  | { kind: "storage_limit" }
  | { kind: "insufficient"; balance: number; needed: number }
  | { kind: "wallet_house_insufficient" }
  | { kind: "house_insufficient" }
  | { kind: "side_conflict"; existingSide: BucksParlaySide };

class HouseInsufficientError extends Error {
  constructor() {
    super("The Bryan Bucks house cannot reserve this parlay liability");
    this.name = "HouseInsufficientError";
  }
}

async function isOpponentPinger(
  input: {
    discordId: DiscordAccountId;
    serverId: DiscordGuildId;
    selectedTeamId: number;
    roster: ReturnType<typeof BucksPoolRosterSchema.parse>;
  },
  prismaClient: ExtendedPrismaClient,
): Promise<boolean> {
  const opponentPuuids = new Set(
    input.roster.participants
      .filter((participant) => participant.teamId !== input.selectedTeamId)
      .flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
  );
  if (opponentPuuids.size === 0) return false;
  const accounts = await prismaClient.account.findMany({
    where: {
      player: {
        is: { discordId: input.discordId, serverId: input.serverId },
      },
    },
    select: { puuid: true },
  });
  return accounts.some((account) => opponentPuuids.has(account.puuid));
}

/**
 * Place or top up a parlay bet, counting and logging the result.
 *
 * Post-commit, same as the outcome market's `placeBet`: `placeParlayBetInner`
 * returns only after its transaction resolves, so the count and transition
 * log cannot survive a rollback.
 */
export async function placeParlayBet(
  input: {
    matchId: string;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    side: BucksParlaySide;
    stake: number;
    now?: Date;
    /** Which surface asked, so the two cannot drift apart unnoticed. */
    surface?: "button" | "command" | "web";
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PlaceParlayBetResult> {
  const result = await placeParlayBetInner(input, prismaClient);
  const surface = input.surface ?? "button";
  bettingParlayBetPlacementsTotal.inc({ surface, result: result.kind });
  if (result.kind === "placed") {
    // The parlay lifecycle has no separate "topped up" event — a top-up still
    // reprices the whole position, so it is recorded as the same placement
    // with the fact noted in `reason`.
    logBucksTransition({
      event: "bucks.parlay_bet.placed",
      matchId: input.matchId,
      serverId: input.serverId,
      actorDiscordId: input.discordId,
      side: result.side,
      stake: input.stake,
      grossPayout: result.grossPayout,
      balanceAfter: result.balanceAfter,
      reason: result.wasTopUp ? "top_up" : "new",
      surface: input.surface ?? "button",
    });
  }
  return result;
}

async function placeParlayBetInner(
  input: {
    matchId: string;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    side: BucksParlaySide;
    stake: number;
    now?: Date;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PlaceParlayBetResult> {
  if (!(await isPolicyEnabled("betting_enabled", { server: input.serverId }))) {
    return { kind: "feature_disabled" };
  }
  const stake = BucksStakeSchema.safeParse(input.stake);
  const side = BucksParlaySideSchema.safeParse(input.side);
  if (!stake.success || !side.success) return { kind: "invalid_stake" };

  const market = await prismaClient.bucksParlayMarket.findUnique({
    where: {
      matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
    },
    select: {
      id: true,
      definition: {
        select: {
          criteria: true,
          selectedTeamId: true,
          yesProbabilityBps: true,
        },
      },
      outcomePool: { select: { roster: true } },
    },
  });
  if (market === null) return { kind: "no_market" };
  const player = await findEligiblePlayer(
    { serverId: input.serverId, discordId: input.discordId },
    prismaClient,
  );
  if (player === undefined) return { kind: "not_eligible" };
  const criteria = GeneratedParlaySchema.parse(
    JSON.parse(market.definition.criteria),
  );
  if (
    criteria.conditions.some(
      (condition) => condition.kind === "opponent_team_pings",
    ) &&
    (await isOpponentPinger(
      {
        discordId: input.discordId,
        serverId: input.serverId,
        selectedTeamId: market.definition.selectedTeamId,
        roster: BucksPoolRosterSchema.parse(
          JSON.parse(market.outcomePool.roster),
        ),
      },
      prismaClient,
    ))
  ) {
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
      // FIRST write: closure check, idempotency guard, and market row lock
      // (a concurrent write re-checks the WHERE and matches 0 rows).
      const claim = await tx.bucksParlayMarket.updateMany({
        where: { id: market.id, marketState: "open", closesAt: { gt: now } },
        data: { updatedAt: now },
      });
      if (claim.count !== 1) return { kind: "window_closed" };

      const existing = await tx.bucksParlayBet.findUnique({
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
        },
      });
      if (existing !== null) {
        const existingSide = BucksParlaySideSchema.parse(existing.side);
        if (existingSide !== side.data) {
          return { kind: "side_conflict", existingSide };
        }
      }

      const totalStake = addInt32(existing?.stake ?? 0, stake.data);
      if (totalStake === undefined) {
        bettingOversizedStakeRejectedTotal.inc({ market: "parlay" });
        return { kind: "storage_limit" };
      }
      const quote = quoteParlayPosition({
        totalStake,
        yesProbabilityBps: market.definition.yesProbabilityBps,
        side: side.data,
      });
      if (quote === undefined) {
        bettingOversizedStakeRejectedTotal.inc({ market: "parlay" });
        return { kind: "storage_limit" };
      }
      const additionalReserve =
        quote.houseReserve - (existing?.houseReserve ?? 0);
      if (additionalReserve < 0) {
        throw new Error("A parlay top-up reduced its total reserved liability");
      }

      const house = await ensureHouseAccountInTransaction(tx, input.serverId);
      bettingParlayHouseBalance.set(house.balance);
      const bet =
        existing === null
          ? await tx.bucksParlayBet.create({
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
          : await tx.bucksParlayBet.update({
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
        kind: "parlay_stake",
        matchId: input.matchId,
        parlayBetId: bet.id,
        context: {
          type: "parlay_stake",
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
            kind: "parlay_reserve",
            matchId: input.matchId,
            parlayBetId: bet.id,
            context: {
              type: "parlay_reserve",
              side: side.data,
              yesProbabilityBps: market.definition.yesProbabilityBps,
              totalStake,
              totalReserve: quote.houseReserve,
              quotedGrossPayout: quote.grossPayout,
            },
          });
        } catch (error) {
          if (error instanceof InsufficientBucksError) {
            throw new HouseInsufficientError();
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
    if (error instanceof HouseInsufficientError) {
      bettingParlayHouseUnavailableTotal.inc();
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
      bettingOversizedStakeRejectedTotal.inc({ market: "parlay" });
      return { kind: "storage_limit" };
    }
    logger.error(`Could not place parlay bet on ${input.matchId}:`, error);
    throw error;
  }
}
