import {
  BucksParlaySideSchema,
  BucksStakeSchema,
  BucksPoolRosterSchema,
  RiotTeamIdSchema,
  type BucksAmount,
  type BucksParlaySide,
  type BucksStake,
  type DiscordAccountId,
  type DiscordGuildId,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { BETTING_TEAM_IDS, outcomeLabel } from "#src/betting/team.ts";
import { bettingAnchor, subjectFraming } from "#src/betting/components.ts";
import { marketSide } from "#src/betting/markets/open-market.ts";
import { cancellationHouseCut } from "#src/betting/eligibility/house-cut.ts";
import {
  GeneratedParlaySchema,
  ParlaySubjectsSchema,
  renderParlay,
} from "#src/betting/parlays/model/parlay-criteria.ts";
import { formatDecimalOdds } from "#src/betting/parlays/model/parlay-odds.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * The open markets as the web surface may see them — a data-only sibling of
 * the Discord market-message renderers.
 *
 * Privacy boundaries, cross-checked against those renderers:
 * - Outcome and match-parlay positions are public with bettor identity and
 *   stake, exactly as the market messages render them; house rows and
 *   cancelled bets are excluded.
 * - No fee, window, cap, or rounding copy appears in any payload — rule
 *   numbers are stated only by `/bb rules` and the docs. The caller-scoped
 *   `cancellationFee` is a computed amount for the caller's own position, not
 *   a rule statement.
 */

export type OpenOutcomeMarketSide = {
  teamId: RiotTeamId;
  /** WIN/LOSE relative to the game's tracked anchor, or Blue/Red when mixed. */
  label: "WIN" | "LOSE" | "Blue" | "Red";
  trackedPlayers: string[];
  totalStake: number;
  betCount: number;
  positions: { discordId: string; stake: number }[];
};

export type OpenOutcomeMarketView = {
  matchId: string;
  closesAt: Date;
  sides: OpenOutcomeMarketSide[];
  yourPosition: {
    teamId: RiotTeamId;
    offeredStake: BucksStake;
    /** What cancelling right now would cost, computed server-side. */
    cancellationFee: BucksAmount;
  } | null;
};

export type OpenParlayMarketView = {
  matchId: string;
  closesAt: Date;
  subjects: string[];
  legs: string[];
  yesProbabilityBps: number;
  yesOdds: string;
  noOdds: string;
  positions: { discordId: string; side: BucksParlaySide; stake: number }[];
  yourPosition: { side: BucksParlaySide; stake: number } | null;
};

export type OpenMarketsView = {
  /** Clock-skew anchor for client countdowns; the server stays authoritative. */
  serverNow: Date;
  outcome: OpenOutcomeMarketView[];
  parlays: OpenParlayMarketView[];
};

function decimalOdds(yesProbabilityBps: number): {
  yesOdds: string;
  noOdds: string;
} {
  return {
    yesOdds: formatDecimalOdds(yesProbabilityBps),
    noOdds: formatDecimalOdds(10_000 - yesProbabilityBps),
  };
}

async function loadOutcomeMarkets(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId; now: Date },
  prismaClient: ExtendedPrismaClient,
): Promise<OpenOutcomeMarketView[]> {
  const pools = await prismaClient.bucksMatchPool.findMany({
    where: {
      serverId: input.serverId,
      poolState: "open",
      closesAt: { gt: input.now },
    },
    orderBy: [{ closesAt: "asc" }, { id: "asc" }],
    select: {
      matchId: true,
      closesAt: true,
      roster: true,
      bets: {
        where: { betOutcome: "pending", bucksAccount: { isHouse: false } },
        orderBy: { id: "asc" },
        select: {
          predictedTeamId: true,
          stake: true,
          bucksAccount: { select: { discordId: true } },
        },
      },
    },
  });

  return pools.map((pool) => {
    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    const anchor = bettingAnchor(roster);
    const framing = anchor === undefined ? undefined : subjectFraming(anchor);
    const sides = BETTING_TEAM_IDS.map((teamId) => {
      const sideBets = pool.bets.filter(
        (bet) => RiotTeamIdSchema.parse(bet.predictedTeamId) === teamId,
      );
      return {
        teamId,
        label: outcomeLabel(teamId, framing),
        ...marketSide(teamId, roster, pool.bets),
        positions: sideBets.map((bet) => ({
          discordId: bet.bucksAccount.discordId,
          stake: bet.stake,
        })),
      };
    });
    const yourBet = pool.bets.find(
      (bet) => bet.bucksAccount.discordId === input.discordId,
    );
    return {
      matchId: pool.matchId,
      closesAt: pool.closesAt,
      sides,
      yourPosition:
        yourBet === undefined
          ? null
          : {
              teamId: RiotTeamIdSchema.parse(yourBet.predictedTeamId),
              // Parsed at the read boundary so the fee quote below is branded
              // arithmetic rather than a bare number leaving this module.
              offeredStake: BucksStakeSchema.parse(yourBet.stake),
              cancellationFee: cancellationHouseCut(
                BucksStakeSchema.parse(yourBet.stake),
              ),
            },
    };
  });
}

async function loadParlayMarkets(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId; now: Date },
  prismaClient: ExtendedPrismaClient,
): Promise<OpenParlayMarketView[]> {
  const markets = await prismaClient.bucksParlayMarket.findMany({
    where: {
      serverId: input.serverId,
      marketState: "open",
      closesAt: { gt: input.now },
    },
    orderBy: [{ closesAt: "asc" }, { id: "asc" }],
    select: {
      matchId: true,
      closesAt: true,
      definition: { select: { criteria: true, subjects: true } },
      bets: {
        where: { betOutcome: "pending", bucksAccount: { isHouse: false } },
        orderBy: { id: "asc" },
        select: {
          side: true,
          stake: true,
          bucksAccount: { select: { discordId: true } },
        },
      },
    },
  });

  return markets.map((market) => {
    const criteria = GeneratedParlaySchema.parse(
      JSON.parse(market.definition.criteria),
    );
    const subjects = ParlaySubjectsSchema.parse(
      JSON.parse(market.definition.subjects),
    );
    const positions = market.bets.map((bet) => ({
      discordId: bet.bucksAccount.discordId,
      side: BucksParlaySideSchema.parse(bet.side),
      stake: bet.stake,
    }));
    const yours = positions.find(
      (position) => position.discordId === input.discordId,
    );
    return {
      matchId: market.matchId,
      closesAt: market.closesAt,
      subjects: subjects.map((subject) => subject.alias),
      legs: renderParlay(criteria, subjects),
      yesProbabilityBps: criteria.yesProbabilityBps,
      ...decimalOdds(criteria.yesProbabilityBps),
      positions,
      yourPosition:
        yours === undefined ? null : { side: yours.side, stake: yours.stake },
    };
  });
}

/** Every open market in one guild, shaped for the web. */
export async function getOpenMarketsView(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    now?: Date;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<OpenMarketsView> {
  const now = input.now ?? new Date();
  const scoped = { serverId: input.serverId, discordId: input.discordId, now };
  const [outcome, parlays] = await Promise.all([
    loadOutcomeMarkets(scoped, prismaClient),
    loadParlayMarkets(scoped, prismaClient),
  ]);
  return { serverNow: now, outcome, parlays };
}
