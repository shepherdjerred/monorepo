import {
  BucksLedgerKindSchema,
  BucksParlayMarketStateSchema,
  BucksParlaySideSchema,
  BucksPoolRosterSchema,
  BucksPoolStateSchema,
  RiotTeamIdSchema,
  type BucksLedgerKind,
  type DiscordAccountId,
  type DiscordGuildId,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { SEED_GRANT } from "#src/betting/constants.ts";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import {
  applyBucksDelta,
  InsufficientBucksError,
} from "#src/betting/ledger.ts";
import { ParlaySubjectsSchema } from "#src/betting/parlay-criteria.ts";
import {
  hasTrackedPlayersOnBothTeams,
  outcomeLabel,
} from "#src/betting/team.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isUniqueConstraintError } from "#src/lib/player-admin/shared.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-accounts");

/**
 * Wallets and who is allowed to have one.
 *
 * Eligibility is "you are a tracked player in this guild", i.e. a `Player` row
 * whose `discordId` is linked. That linkage is set from the web dashboard
 * (`lib/player-admin/player-mutations.ts`) or when a subscription is created
 * with a Discord user (`lib/subscription/add.ts`).
 */

export type EligiblePlayer = {
  playerId: number;
  alias: string;
};

/**
 * The tracked player behind a Discord user in one guild, or undefined if that
 * user is not linked to one.
 *
 * A person can be linked to at most one `Player` per guild
 * (`Player @@unique([serverId, alias])` plus a nullable `discordId`), but the
 * schema does not enforce single-linkage, so this takes the lowest id for a
 * stable answer rather than assuming uniqueness.
 */
export async function findEligiblePlayer(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<EligiblePlayer | undefined> {
  const player = await prismaClient.player.findFirst({
    where: { serverId: input.serverId, discordId: input.discordId },
    select: { id: true, alias: true },
    orderBy: { id: "asc" },
  });
  if (player === null) {
    return undefined;
  }
  return { playerId: player.id, alias: player.alias };
}

export type BucksAccountRef = {
  id: number;
  balance: number;
};

/** A guild house cannot fund another welcome grant. */
export class HouseInsufficientError extends Error {
  constructor(readonly requested: number) {
    super(
      `The Bryan Bucks house cannot fund a ${requested.toString()} BB welcome grant`,
    );
    this.name = "HouseInsufficientError";
  }
}

/** The wallet ID for one Discord user in one guild, when it exists. */
export async function findBucksAccountId(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<number | undefined> {
  const account = await prismaClient.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    select: { id: true },
  });
  return account?.id;
}

/**
 * Fetch or create this user's wallet in this guild.
 *
 * A newly created wallet starts at `SEED_GRANT` transferred from the guild
 * house, because earning alone cannot bootstrap the economy: a player with no
 * Bucks cannot place a bet, and betting is the point. The house debit and
 * user credit are paired `seed` ledger rows so the grant is not minted.
 *
 * The row is created at zero and the grant applied through `applyBucksDelta`
 * inside the same transaction, rather than by writing a starting balance
 * alongside a hand-built ledger row. `ledger.ts` is documented as the one place
 * a balance may move, and a bootstrap exception would be a second mutation path
 * that skips its context validation — so a wallet still cannot exist without
 * the entry that explains its balance, and there is still only one writer.
 *
 * Racing callers are handled by catching the unique-constraint violation rather
 * than by locking: two concurrent first-clicks would otherwise both see "no
 * wallet" and both try to seed, granting twice.
 */
export async function ensureBucksAccount(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<BucksAccountRef> {
  const existing = await prismaClient.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    select: { id: true, balance: true },
  });
  if (existing !== null) {
    return existing;
  }

  try {
    return await prismaClient.$transaction(async (tx) => {
      const created = await tx.bucksAccount.create({
        data: {
          serverId: input.serverId,
          discordId: input.discordId,
          balance: 0,
        },
        select: { id: true },
      });
      const house = await ensureHouseAccountInTransaction(tx, input.serverId);
      const transferId = crypto.randomUUID();
      const seedNote = "Welcome grant on first Bryan Bucks wallet";
      try {
        await applyBucksDelta(tx, {
          bucksAccountId: house.id,
          delta: -SEED_GRANT,
          kind: "seed",
          context: {
            type: "seed",
            note: seedNote,
            transferId,
            counterpartyAccountId: created.id,
          },
        });
      } catch (error) {
        if (error instanceof InsufficientBucksError) {
          throw new HouseInsufficientError(SEED_GRANT);
        }
        throw error;
      }
      const balance = await applyBucksDelta(tx, {
        bucksAccountId: created.id,
        delta: SEED_GRANT,
        kind: "seed",
        context: {
          type: "seed",
          note: seedNote,
          transferId,
          counterpartyAccountId: house.id,
        },
      });
      logger.info(
        `💰 Seeded a Bryan Bucks wallet with ${SEED_GRANT.toString()} BB from the house`,
      );
      return { id: created.id, balance };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Another click created it first; theirs is as good as ours.
      return await prismaClient.bucksAccount.findUniqueOrThrow({
        where: {
          serverId_discordId: {
            serverId: input.serverId,
            discordId: input.discordId,
          },
        },
        select: { id: true, balance: true },
      });
    }
    throw error;
  }
}

export type LedgerPageEntry = {
  id: number;
  delta: number;
  balanceAfter: number;
  kind: BucksLedgerKind;
  matchId: string | null;
  context: string;
  createdAt: Date;
};

export const LEDGER_PAGE_SIZE = 10;

export type LedgerPage = {
  entries: LedgerPageEntry[];
  page: number;
  pageSize: number;
  totalEntries: number;
  totalPages: number;
  snapshotId: number | null;
};

/**
 * One stable page of ledger rows, newest first.
 *
 * The first read freezes the account's maximum ledger ID. Every later page
 * filters against that ID, so new earnings and settlements cannot move rows
 * between pages while someone is navigating the response.
 */
export async function getLedgerPage(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    page: number;
    snapshotId?: number;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<LedgerPage> {
  const bucksAccountId = await findBucksAccountId(input, prismaClient);
  if (bucksAccountId === undefined) {
    return {
      entries: [],
      page: 0,
      pageSize: LEDGER_PAGE_SIZE,
      totalEntries: 0,
      totalPages: 0,
      snapshotId: null,
    };
  }

  const newest = await prismaClient.bucksLedgerEntry.findFirst({
    where: {
      bucksAccountId,
      ...(input.snapshotId === undefined
        ? {}
        : { id: { lte: input.snapshotId } }),
    },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  const snapshotId = input.snapshotId ?? newest?.id ?? null;
  if (snapshotId === null) {
    return {
      entries: [],
      page: 0,
      pageSize: LEDGER_PAGE_SIZE,
      totalEntries: 0,
      totalPages: 0,
      snapshotId: null,
    };
  }
  const where = {
    bucksAccountId,
    id: { lte: snapshotId },
  };
  const totalEntries = await prismaClient.bucksLedgerEntry.count({ where });
  const totalPages = Math.ceil(totalEntries / LEDGER_PAGE_SIZE);
  const page = Math.min(input.page, Math.max(totalPages - 1, 0));
  const rows = await prismaClient.bucksLedgerEntry.findMany({
    where,
    orderBy: { id: "desc" },
    skip: page * LEDGER_PAGE_SIZE,
    take: LEDGER_PAGE_SIZE,
    select: {
      id: true,
      delta: true,
      balanceAfter: true,
      kind: true,
      matchId: true,
      context: true,
      createdAt: true,
    },
  });
  const entries = rows.map((row) => ({
    ...row,
    kind: BucksLedgerKindSchema.parse(row.kind),
  }));

  return {
    entries,
    page,
    pageSize: LEDGER_PAGE_SIZE,
    totalEntries,
    totalPages,
    snapshotId,
  };
}

type PendingPositionBase = {
  matchId: string;
  closesAt: Date;
  poolState: string;
};

export type PendingPosition =
  | (PendingPositionBase & {
      marketType: "outcome";
      gameAlias: string;
      teamId: RiotTeamId;
      /** WIN/LOSE for this game, or Blue/Red when both teams are tracked. */
      sideLabel: string;
      offeredStake: number;
      matchedStake: number | null;
      unmatchedStake: number | null;
    })
  | (PendingPositionBase & {
      marketType: "parlay";
      subjectAlias: string;
      side: "YES" | "NO";
      stake: number;
    });

export type PersonalBucksView = {
  balance: number;
  totalAtRisk: number;
  pendingPositionCount: number;
  pendingPositions: PendingPosition[];
};

/** The caller's balance and at most ten of their pending positions. */
export async function getPersonalBucksView(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PersonalBucksView | undefined> {
  return await prismaClient.$transaction(async (tx) => {
    const account = await tx.bucksAccount.findUnique({
      where: {
        serverId_discordId: {
          serverId: input.serverId,
          discordId: input.discordId,
        },
      },
      select: { id: true, balance: true },
    });
    if (account === null) {
      return;
    }

    const [outcomeBets, parlayAggregate, parlayBets] = await Promise.all([
      tx.bucksBet.findMany({
        where: { bucksAccountId: account.id, betOutcome: "pending" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          createdAt: true,
          stake: true,
          matchedStake: true,
          unmatchedStake: true,
          predictedTeamId: true,
          subjectPuuid: true,
          pool: {
            select: {
              matchId: true,
              roster: true,
              closesAt: true,
              poolState: true,
            },
          },
        },
      }),
      tx.bucksParlayBet.aggregate({
        where: { bucksAccountId: account.id, betOutcome: "pending" },
        _sum: { stake: true },
        _count: true,
      }),
      tx.bucksParlayBet.findMany({
        where: { bucksAccountId: account.id, betOutcome: "pending" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        select: {
          id: true,
          createdAt: true,
          stake: true,
          side: true,
          market: {
            select: {
              matchId: true,
              closesAt: true,
              marketState: true,
              definition: { select: { subjects: true } },
            },
          },
        },
      }),
    ]);

    const outcomePositions = outcomeBets.map((bet) => {
      const roster = BucksPoolRosterSchema.parse(
        JSON.parse(bet.pool.roster),
      ).participants;
      const subject = roster.find(
        (participant) => participant.puuid === bet.subjectPuuid,
      );
      if (subject?.trackedAlias === undefined) {
        throw new Error(
          `Pending Bryan Bucks position ${bet.pool.matchId} has no tracked subject`,
        );
      }
      return {
        id: bet.id,
        createdAt: bet.createdAt,
        marketType: "outcome" as const,
        matchId: bet.pool.matchId,
        gameAlias: subject.trackedAlias,
        teamId: RiotTeamIdSchema.parse(bet.predictedTeamId),
        // The roster is already parsed here, so framing costs nothing extra.
        sideLabel: outcomeLabel(RiotTeamIdSchema.parse(bet.predictedTeamId), {
          anchorTeamId: subject.teamId,
          mixedTeams: hasTrackedPlayersOnBothTeams(roster),
        }),
        offeredStake: bet.stake,
        matchedStake: bet.matchedStake,
        unmatchedStake: bet.unmatchedStake,
        closesAt: bet.pool.closesAt,
        poolState: BucksPoolStateSchema.parse(bet.pool.poolState),
      };
    });
    const parlayPositions = parlayBets.map((bet) => ({
      id: bet.id,
      createdAt: bet.createdAt,
      marketType: "parlay" as const,
      matchId: bet.market.matchId,
      subjectAlias: `Parlay (${ParlaySubjectsSchema.parse(
        JSON.parse(bet.market.definition.subjects),
      )
        .map((subject) => subject.alias)
        .join(", ")})`,
      side: BucksParlaySideSchema.parse(bet.side),
      stake: bet.stake,
      closesAt: bet.market.closesAt,
      poolState: BucksParlayMarketStateSchema.parse(bet.market.marketState),
    }));
    const pendingPositions = [...outcomePositions, ...parlayPositions]
      .toSorted(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id - left.id,
      )
      .slice(0, 10)
      .map(({ id: _id, createdAt: _createdAt, ...position }) => position);

    return {
      balance: account.balance,
      totalAtRisk:
        outcomeBets.reduce(
          (total, bet) => total + (bet.matchedStake ?? bet.stake),
          0,
        ) + (parlayAggregate._sum.stake ?? 0),
      pendingPositionCount: outcomeBets.length + parlayAggregate._count,
      pendingPositions,
    };
  });
}

export type FullLeaderboardRow = {
  accountId: number;
  discordId: string;
  balance: number;
};

/** Every non-house wallet in one guild, for the scheduled weekly post only. */
export async function getFullLeaderboard(
  input: { serverId: DiscordGuildId },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<FullLeaderboardRow[]> {
  const rows = await prismaClient.bucksAccount.findMany({
    where: { serverId: input.serverId, isHouse: false },
    orderBy: [{ balance: "desc" }, { id: "asc" }],
    select: { id: true, discordId: true, balance: true },
  });
  return rows.map((row) => ({
    accountId: row.id,
    discordId: row.discordId,
    balance: row.balance,
  }));
}
