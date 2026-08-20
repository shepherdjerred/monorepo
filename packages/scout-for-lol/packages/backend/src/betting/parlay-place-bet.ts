import { z } from "zod";
import {
  BucksParlaySideSchema,
  BucksStakeSchema,
  type BucksParlaySide,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  ensureBucksAccount,
  findEligiblePlayers,
  type EligiblePlayer,
} from "#src/betting/accounts.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import {
  applyBucksDelta,
  BucksStorageOverflowError,
  InsufficientBucksError,
} from "#src/betting/ledger.ts";
import { addInt32, quoteParlayPosition } from "#src/betting/parlay-odds.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  bettingOversizedStakeRejectedTotal,
  bettingParlayHouseBalance,
  bettingParlayHouseUnavailableTotal,
} from "#src/metrics/betting-parlay.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-parlay-place-bet");

export type PlaceParlayBetResult =
  | {
      kind: "placed";
      side: BucksParlaySide;
      totalStake: number;
      grossPayout: number;
      balanceAfter: number;
    }
  | { kind: "window_closed" }
  | { kind: "no_market" }
  | { kind: "feature_disabled" }
  | { kind: "not_eligible" }
  | { kind: "invalid_stake" }
  | { kind: "storage_limit" }
  | { kind: "insufficient"; balance: number; needed: number }
  | { kind: "house_insufficient" }
  | { kind: "side_conflict"; existingSide: BucksParlaySide };

class HouseInsufficientError extends Error {
  constructor() {
    super("The Bryan Bucks house cannot reserve this parlay liability");
    this.name = "HouseInsufficientError";
  }
}

const ParlayGenerationContextSchema = z
  .object({
    opponentPuuids: z.array(z.string()).optional(),
    opponentTrackedAliases: z.array(z.string()).optional(),
    opponentTrackedPuuids: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

function isTrackedOpponent(
  generationContext: string,
  players: readonly EligiblePlayer[],
): boolean {
  const parsed = ParlayGenerationContextSchema.safeParse(
    JSON.parse(generationContext),
  );
  if (!parsed.success) {
    return false;
  }
  const { opponentPuuids, opponentTrackedAliases, opponentTrackedPuuids } =
    parsed.data;
  const blockedPuuids = opponentPuuids ?? opponentTrackedPuuids;
  if (blockedPuuids === undefined) {
    return (opponentTrackedAliases?.length ?? 0) > 0;
  }
  return players.some((player) =>
    player.puuids.some((puuid) => blockedPuuids.includes(puuid)),
  );
}

export async function placeParlayBet(
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
  if (!getFlag("betting_enabled", { server: input.serverId })) {
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
        select: { yesProbabilityBps: true, generationContext: true },
      },
    },
  });
  if (market === null) return { kind: "no_market" };
  const players = await findEligiblePlayers(
    { serverId: input.serverId, discordId: input.discordId },
    prismaClient,
  );
  if (players.length === 0) return { kind: "not_eligible" };
  if (isTrackedOpponent(market.definition.generationContext, players)) {
    return { kind: "not_eligible" };
  }
  const account = await ensureBucksAccount(
    { serverId: input.serverId, discordId: input.discordId },
    prismaClient,
  );

  try {
    return await prismaClient.$transaction(async (tx) => {
      const now = input.now ?? new Date();
      // FIRST write: closure check, idempotency guard, and SQLite writer lock.
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
