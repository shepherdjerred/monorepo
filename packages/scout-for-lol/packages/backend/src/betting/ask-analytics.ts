import {
  BucksLedgerKindSchema,
  BucksParlaySideSchema,
  BucksPoolRosterSchema,
  BucksPoolStateSchema,
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  RiotTeamIdSchema,
  type BucksLedgerKind,
  type BucksPoolState,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { Prisma } from "#generated/prisma/client/index.js";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  BucksAskBetOutcomeSchema,
  type BucksAskBetOutcome,
  type BucksBetDirection,
  type BucksSubjectResult,
} from "#src/betting/ask-analytics-schema.ts";
import {
  netBbForOutcome,
  outcomeGrossPayout,
  parlayGrossPayout,
} from "#src/betting/ask-analytics-payout.ts";

export type BucksAskAccountFact = {
  discordId: DiscordAccountId;
  balance: number;
  createdAt: Date;
};

export type BucksAskLedgerFact = {
  discordId: DiscordAccountId;
  kind: BucksLedgerKind;
  delta: number;
  matchId: string | null;
  createdAt: Date;
};

export type BucksAskBetFact = {
  positionType: "outcome" | "parlay";
  discordId: DiscordAccountId;
  matchId: string;
  marketKey: string;
  subjectPuuid: LeaguePuuid | null;
  subjectAlias: string | null;
  subjectAliases: readonly string[];
  subjectTeamId: RiotTeamId | null;
  direction: BucksBetDirection;
  subjectResult: BucksSubjectResult;
  outcome: BucksAskBetOutcome;
  stake: number;
  payout: number | null;
  grossPayout: number | null;
  netBb: number | null;
  createdAt: Date;
  eventAt: Date;
};

type PoolFact = {
  id: number;
  matchId: string;
  poolState: BucksPoolState;
  winningTeamId: RiotTeamId | null;
  createdAt: Date;
  roster: ReturnType<typeof BucksPoolRosterSchema.parse>;
};

type AliasHistory = {
  latestAlias: string;
  latestAt: Date;
  aliases: Set<string>;
};

export type BucksAskAnalyticsDataset = {
  loadedAt: Date;
  accounts: readonly BucksAskAccountFact[];
  ledger: readonly BucksAskLedgerFact[];
  bets: readonly BucksAskBetFact[];
  marketCount: number;
  aliasesByPuuid: ReadonlyMap<LeaguePuuid, AliasHistory>;
};

export const BUCKS_ASK_DATASET_LIMITS = {
  accounts: 5000,
  ledgerEntries: 100_000,
  pools: 20_000,
  bets: 50_000,
} as const;

export class BucksAskDatasetTooLargeError extends Error {
  constructor(kind: string, count: number, limit: number) {
    super(
      `Bryan Bucks ${kind} count ${count.toString()} exceeds the safe analysis limit ${limit.toString()}`,
    );
    this.name = "BucksAskDatasetTooLargeError";
  }
}

type BucksAskAnalyticsReadClient = Pick<
  ExtendedPrismaClient,
  | "bucksAccount"
  | "bucksLedgerEntry"
  | "bucksMatchPool"
  | "bucksParlayMarket"
  | "bucksBet"
  | "bucksParlayBet"
>;

export async function loadBucksAskAnalyticsDataset(
  serverId: DiscordGuildId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<BucksAskAnalyticsDataset> {
  const { accountRows, poolRows, betRows, parlayBetRows, parlayMarketCount } =
    await prismaClient.$transaction(
      async (transaction) => await readAnalyticsSnapshot(serverId, transaction),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

  const pools = new Map<number, PoolFact>();
  const aliasesByPuuid = new Map<LeaguePuuid, AliasHistory>();
  for (const row of poolRows) {
    const roster = BucksPoolRosterSchema.parse(JSON.parse(row.roster));
    const pool: PoolFact = {
      id: row.id,
      matchId: row.matchId,
      poolState: BucksPoolStateSchema.parse(row.poolState),
      winningTeamId:
        row.winningTeamId === null
          ? null
          : RiotTeamIdSchema.parse(row.winningTeamId),
      createdAt: row.createdAt,
      roster,
    };
    validatePoolWinner(pool);
    pools.set(row.id, pool);
    collectAliases(aliasesByPuuid, pool);
  }

  const accounts: BucksAskAccountFact[] = [];
  const ledger: BucksAskLedgerFact[] = [];
  for (const account of accountRows) {
    const discordId = DiscordAccountIdSchema.parse(account.discordId);
    accounts.push({
      discordId,
      balance: account.balance,
      createdAt: account.createdAt,
    });
    for (const entry of account.ledgerEntries) {
      ledger.push({
        discordId,
        kind: BucksLedgerKindSchema.parse(entry.kind),
        delta: entry.delta,
        matchId: entry.matchId,
        createdAt: entry.createdAt,
      });
    }
  }

  const bets = betRows.map((row) => {
    const pool = pools.get(row.poolId);
    if (pool === undefined) {
      throw new Error(
        `Bryan Bucks bet references pool ${row.poolId.toString()} outside its server dataset`,
      );
    }
    const subjectPuuid = LeaguePuuidSchema.parse(row.subjectPuuid);
    const subject = pool.roster.participants.find(
      (participant) => participant.puuid === subjectPuuid,
    );
    if (subject?.puuid === undefined || subject.puuid === null) {
      throw new Error(
        `Bryan Bucks subject ${subjectPuuid} is missing from pool ${pool.id.toString()}'s frozen roster`,
      );
    }
    const aliasHistory = aliasesByPuuid.get(subjectPuuid);
    if (aliasHistory === undefined) {
      throw new Error(
        `Bryan Bucks subject ${subjectPuuid} has no tracked alias in the frozen pool history`,
      );
    }
    const predictedTeamId = RiotTeamIdSchema.parse(row.predictedTeamId);
    const outcome = BucksAskBetOutcomeSchema.parse(row.betOutcome);
    const stake = row.matchedStake ?? row.stake;
    const grossPayout = outcomeGrossPayout({
      outcome,
      storedGrossPayout: row.grossPayout,
      payout: row.payout,
      stake,
      payoutCredits: row.ledgerEntries.map((entry) => entry.delta),
    });
    const netBb = netBbForOutcome(outcome, grossPayout, stake);
    return {
      positionType: "outcome",
      discordId: DiscordAccountIdSchema.parse(row.bucksAccount.discordId),
      matchId: pool.matchId,
      marketKey: `outcome:${pool.id.toString()}`,
      subjectPuuid,
      subjectAlias: aliasHistory.latestAlias,
      subjectAliases: [...aliasHistory.aliases],
      subjectTeamId: subject.teamId,
      direction: predictedTeamId === subject.teamId ? "for" : "against",
      subjectResult: subjectResult(pool, subject.teamId),
      outcome,
      stake,
      payout: row.payout,
      grossPayout,
      netBb,
      createdAt: row.createdAt,
      eventAt: row.settledAt ?? row.createdAt,
    } satisfies BucksAskBetFact;
  });

  const parlayBets = parlayBetRows.map((row) => {
    const outcome = BucksAskBetOutcomeSchema.parse(row.betOutcome);
    const side = BucksParlaySideSchema.parse(row.side);
    const grossPayout = parlayGrossPayout(
      outcome,
      row.payout,
      row.stake,
      row.grossPayout,
    );
    return {
      positionType: "parlay",
      discordId: DiscordAccountIdSchema.parse(row.bucksAccount.discordId),
      matchId: row.market.matchId,
      marketKey: `parlay:${row.market.id.toString()}`,
      subjectPuuid: null,
      subjectAlias: null,
      subjectAliases: [],
      subjectTeamId: null,
      direction: side === "YES" ? "yes" : "no",
      subjectResult: "not_applicable",
      outcome,
      stake: row.stake,
      payout: row.payout,
      grossPayout,
      netBb: netBbForOutcome(outcome, grossPayout, row.stake),
      createdAt: row.createdAt,
      eventAt: row.settledAt ?? row.createdAt,
    } satisfies BucksAskBetFact;
  });

  return {
    loadedAt: new Date(),
    accounts,
    ledger,
    bets: [...bets, ...parlayBets],
    marketCount: pools.size + parlayMarketCount,
    aliasesByPuuid,
  };
}

async function readAnalyticsSnapshot(
  serverId: DiscordGuildId,
  prismaClient: BucksAskAnalyticsReadClient,
) {
  const [
    accountCount,
    ledgerEntryCount,
    poolCount,
    parlayMarketCount,
    betCount,
    parlayBetCount,
  ] = await Promise.all([
    prismaClient.bucksAccount.count({
      where: { serverId, isHouse: false },
    }),
    prismaClient.bucksLedgerEntry.count({
      where: { bucksAccount: { serverId, isHouse: false } },
    }),
    prismaClient.bucksMatchPool.count({ where: { serverId } }),
    prismaClient.bucksParlayMarket.count({ where: { serverId } }),
    prismaClient.bucksBet.count({
      where: {
        bucksAccount: { serverId, isHouse: false },
        betOutcome: { not: "cancelled" },
      },
    }),
    prismaClient.bucksParlayBet.count({
      where: {
        bucksAccount: { serverId, isHouse: false },
        betOutcome: { not: "cancelled" },
      },
    }),
  ]);
  assertDatasetCount(
    "account",
    accountCount,
    BUCKS_ASK_DATASET_LIMITS.accounts,
  );
  assertDatasetCount(
    "ledger entry",
    ledgerEntryCount,
    BUCKS_ASK_DATASET_LIMITS.ledgerEntries,
  );
  assertDatasetCount("pool", poolCount, BUCKS_ASK_DATASET_LIMITS.pools);
  assertDatasetCount(
    "parlay market",
    parlayMarketCount,
    BUCKS_ASK_DATASET_LIMITS.pools,
  );
  assertDatasetCount(
    "bet",
    betCount + parlayBetCount,
    BUCKS_ASK_DATASET_LIMITS.bets,
  );

  const [accountRows, poolRows, betRows, parlayBetRows] = await Promise.all([
    prismaClient.bucksAccount.findMany({
      where: { serverId, isHouse: false },
      select: {
        discordId: true,
        balance: true,
        createdAt: true,
        ledgerEntries: {
          select: {
            kind: true,
            delta: true,
            matchId: true,
            createdAt: true,
          },
        },
      },
    }),
    prismaClient.bucksMatchPool.findMany({
      where: { serverId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        matchId: true,
        poolState: true,
        winningTeamId: true,
        roster: true,
        createdAt: true,
      },
    }),
    prismaClient.bucksBet.findMany({
      where: {
        bucksAccount: { serverId, isHouse: false },
        betOutcome: { not: "cancelled" },
      },
      select: {
        poolId: true,
        predictedTeamId: true,
        subjectPuuid: true,
        stake: true,
        matchedStake: true,
        betOutcome: true,
        grossPayout: true,
        payout: true,
        settledAt: true,
        createdAt: true,
        bucksAccount: { select: { discordId: true } },
        ledgerEntries: {
          where: { kind: "bet_payout" },
          select: { delta: true },
        },
      },
    }),
    prismaClient.bucksParlayBet.findMany({
      where: {
        bucksAccount: { serverId, isHouse: false },
        betOutcome: { not: "cancelled" },
      },
      select: {
        side: true,
        stake: true,
        grossPayout: true,
        betOutcome: true,
        payout: true,
        settledAt: true,
        createdAt: true,
        bucksAccount: { select: { discordId: true } },
        market: { select: { id: true, matchId: true } },
      },
    }),
  ]);

  return {
    accountRows,
    poolRows,
    betRows,
    parlayBetRows,
    parlayMarketCount,
  };
}

function assertDatasetCount(kind: string, count: number, limit: number): void {
  if (count > limit) {
    throw new BucksAskDatasetTooLargeError(kind, count, limit);
  }
}

function collectAliases(
  aliasesByPuuid: Map<LeaguePuuid, AliasHistory>,
  pool: PoolFact,
): void {
  for (const participant of pool.roster.participants) {
    if (participant.puuid === null || participant.trackedAlias === undefined) {
      continue;
    }
    const existing = aliasesByPuuid.get(participant.puuid);
    if (existing === undefined) {
      aliasesByPuuid.set(participant.puuid, {
        latestAlias: participant.trackedAlias,
        latestAt: pool.createdAt,
        aliases: new Set([participant.trackedAlias]),
      });
      continue;
    }
    existing.aliases.add(participant.trackedAlias);
    if (pool.createdAt >= existing.latestAt) {
      existing.latestAlias = participant.trackedAlias;
      existing.latestAt = pool.createdAt;
    }
  }
}

function subjectResult(
  pool: PoolFact,
  subjectTeamId: RiotTeamId,
): BucksSubjectResult {
  if (pool.winningTeamId === null) {
    return "unresolved";
  }
  return pool.winningTeamId === subjectTeamId ? "won" : "lost";
}

function validatePoolWinner(pool: PoolFact): void {
  if (pool.poolState === "settled" && pool.winningTeamId === null) {
    throw new Error("A settled Bryan Bucks pool must have a winning team");
  }
  if (pool.poolState !== "settled" && pool.winningTeamId !== null) {
    throw new Error("Only a settled Bryan Bucks pool may have a winning team");
  }
}
