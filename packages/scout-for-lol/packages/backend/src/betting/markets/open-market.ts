import {
  BucksPoolRosterSchema,
  RiotTeamIdSchema,
  type DiscordGuildId,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export type OpenMarketSide = {
  trackedPlayers: string[];
  totalStake: number;
  betCount: number;
};

export type OpenMarketAggregate = {
  matchId: string;
  closesAt: Date;
  blue: OpenMarketSide;
  red: OpenMarketSide;
};

export function marketSide(
  teamId: RiotTeamId,
  roster: ReturnType<typeof BucksPoolRosterSchema.parse>["participants"],
  bets: readonly { predictedTeamId: number; stake: number }[],
): OpenMarketSide {
  const sideBets = bets.filter(
    (bet) => RiotTeamIdSchema.parse(bet.predictedTeamId) === teamId,
  );
  return {
    trackedPlayers: roster
      .filter(
        (participant) =>
          participant.teamId === teamId && participant.puuid !== null,
      )
      .map((participant) => participant.trackedAlias)
      .filter((alias) => alias !== undefined),
    totalStake: sideBets.reduce((total, bet) => total + bet.stake, 0),
    betCount: sideBets.length,
  };
}

/** Every currently open market, with anonymous stake aggregates only. */
export async function getOpenMarketAggregates(
  input: { serverId: DiscordGuildId; now?: Date },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<OpenMarketAggregate[]> {
  const pools = await prismaClient.bucksMatchPool.findMany({
    where: {
      serverId: input.serverId,
      poolState: "open",
      closesAt: { gt: input.now ?? new Date() },
    },
    orderBy: [{ closesAt: "asc" }, { id: "asc" }],
    select: {
      matchId: true,
      closesAt: true,
      roster: true,
      bets: {
        where: { betOutcome: "pending", bucksAccount: { isHouse: false } },
        select: { predictedTeamId: true, stake: true },
      },
    },
  });

  return pools.map((pool) => {
    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    return {
      matchId: pool.matchId,
      closesAt: pool.closesAt,
      blue: marketSide(100, roster, pool.bets),
      red: marketSide(200, roster, pool.bets),
    };
  });
}
