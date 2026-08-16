import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { SEED_GRANT } from "#src/betting/constants.ts";
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

/**
 * Fetch or create this user's wallet in this guild.
 *
 * A newly created wallet starts at `SEED_GRANT` with a matching `seed` ledger
 * row, because earning alone cannot bootstrap the economy: a player with no
 * Bucks cannot place a bet, and betting is the point. The grant and the row are
 * written in one transaction so a wallet can never exist without the entry that
 * explains its balance.
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
          balance: SEED_GRANT,
        },
        select: { id: true, balance: true },
      });
      await tx.bucksLedgerEntry.create({
        data: {
          bucksAccountId: created.id,
          delta: SEED_GRANT,
          balanceAfter: SEED_GRANT,
          kind: "seed",
          context: JSON.stringify({
            type: "seed",
            note: "Welcome grant on first Bryan Bucks wallet",
          }),
        },
      });
      logger.info(
        `💰 Seeded a Bryan Bucks wallet with ${SEED_GRANT.toString()} BB`,
      );
      return created;
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

/** Current balance, or undefined when the user has never had a wallet here. */
export async function getBalance(
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
    select: { balance: true },
  });
  return account?.balance;
}

export type LedgerPageEntry = {
  delta: number;
  balanceAfter: number;
  kind: string;
  matchId: string | null;
  context: string;
  createdAt: Date;
};

/** Most recent ledger rows, newest first — the "how did I get these" view. */
export async function getLedgerPage(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    limit: number;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<LedgerPageEntry[]> {
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
    return [];
  }
  return await prismaClient.bucksLedgerEntry.findMany({
    where: { bucksAccountId: account.id },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    select: {
      delta: true,
      balanceAfter: true,
      kind: true,
      matchId: true,
      context: true,
      createdAt: true,
    },
  });
}

/** Top balances in a guild, for the leaderboard. */
export async function getLeaderboard(
  input: { serverId: DiscordGuildId; limit: number },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<{ discordId: string; balance: number }[]> {
  return await prismaClient.bucksAccount.findMany({
    where: { serverId: input.serverId },
    orderBy: [{ balance: "desc" }, { id: "asc" }],
    take: input.limit,
    select: { discordId: true, balance: true },
  });
}
