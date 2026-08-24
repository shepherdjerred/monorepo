import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { Db } from "#src/lib/audit/index.ts";
import { bettingPeekPassesTotal } from "#src/metrics/betting.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

export const PEEK_PASS_DURATION_MS = 24 * 60 * 60 * 1000;

/** "24-hour", derived — the duration used to be hand-typed on five surfaces. */
export const PEEK_PASS_DURATION_LABEL = `${Math.floor(
  PEEK_PASS_DURATION_MS / 3_600_000,
).toString()}-hour`;
export const PEEK_PASS_QUOTE_TTL_MS = 10 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const MINIMUM_PRICE = 5;

type LedgerLotInput = {
  id: number;
  delta: number;
  balanceAfter: number;
  createdAt: Date;
};

type RemainingLot = {
  amount: number;
  createdAt: Date;
};

export type PeekPassPrice = {
  price: number;
  balance: number;
  weightedAgeWeeks: number;
};

/** Reconstruct the wallet as FIFO lots and price a 24-hour pass. */
export function calculatePeekPassPrice(input: {
  balance: number;
  ledger: readonly LedgerLotInput[];
  now: Date;
}): PeekPassPrice {
  const lots: RemainingLot[] = [];
  let derivedBalance = 0;

  for (const entry of input.ledger) {
    derivedBalance += entry.delta;
    if (derivedBalance !== entry.balanceAfter || derivedBalance < 0) {
      throw new Error(
        `Bryan Bucks ledger drift at entry ${entry.id.toString()}: derived ${derivedBalance.toString()}, stored ${entry.balanceAfter.toString()}`,
      );
    }

    if (entry.delta > 0) {
      lots.push({ amount: entry.delta, createdAt: entry.createdAt });
      continue;
    }

    let remainingDebit = -entry.delta;
    while (remainingDebit > 0) {
      const oldest = lots[0];
      if (oldest === undefined) {
        throw new Error(
          `Bryan Bucks ledger entry ${entry.id.toString()} spends Bucks that no FIFO lot contains`,
        );
      }
      const consumed = Math.min(oldest.amount, remainingDebit);
      oldest.amount -= consumed;
      remainingDebit -= consumed;
      if (oldest.amount === 0) {
        lots.shift();
      }
    }
  }

  if (derivedBalance !== input.balance) {
    throw new Error(
      `Bryan Bucks wallet drift: ledger derives ${derivedBalance.toString()}, account stores ${input.balance.toString()}`,
    );
  }
  if (input.balance < MINIMUM_PRICE) {
    return {
      price: MINIMUM_PRICE,
      balance: input.balance,
      weightedAgeWeeks: 0,
    };
  }

  const weightedAgeMs = lots.reduce(
    (total, lot) =>
      total +
      lot.amount * Math.max(0, input.now.getTime() - lot.createdAt.getTime()),
    0,
  );
  const weightedAgeWeeks = Math.floor(weightedAgeMs / input.balance / WEEK_MS);
  const percentage = Math.min(25, 10 + weightedAgeWeeks);
  return {
    price: Math.max(
      MINIMUM_PRICE,
      Math.ceil((input.balance * percentage) / 100),
    ),
    balance: input.balance,
    weightedAgeWeeks,
  };
}

export type PeekPassQuoteResult =
  | { kind: "quoted"; quote: PeekPassPrice; quotedAt: Date }
  | { kind: "no_wallet" }
  | { kind: "insufficient"; balance: number }
  | { kind: "active"; expiresAt: Date };

async function calculateForAccount(
  account: { id: number; balance: number },
  now: Date,
  prismaClient: Pick<Db, "bucksLedgerEntry">,
): Promise<PeekPassPrice> {
  const ledger = await prismaClient.bucksLedgerEntry.findMany({
    where: { bucksAccountId: account.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, delta: true, balanceAfter: true, createdAt: true },
  });
  return calculatePeekPassPrice({ balance: account.balance, ledger, now });
}

export async function quotePeekPass(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    now?: Date;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PeekPassQuoteResult> {
  const now = input.now ?? new Date();
  const account = await prismaClient.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    select: {
      id: true,
      balance: true,
      isHouse: true,
      peekPassExpiresAt: true,
    },
  });
  if (account === null || account.isHouse) {
    return { kind: "no_wallet" };
  }
  if (
    account.peekPassExpiresAt !== null &&
    account.peekPassExpiresAt.getTime() > now.getTime()
  ) {
    return { kind: "active", expiresAt: account.peekPassExpiresAt };
  }
  if (account.balance < MINIMUM_PRICE) {
    return { kind: "insufficient", balance: account.balance };
  }
  return {
    kind: "quoted",
    quote: await calculateForAccount(account, now, prismaClient),
    quotedAt: now,
  };
}

class QuoteChangedError extends Error {
  constructor(readonly quote: PeekPassPrice) {
    super("Peek-pass quote expired or changed");
    this.name = "QuoteChangedError";
  }
}

class PassClaimError extends Error {
  constructor() {
    super("Peek pass could not be claimed");
    this.name = "PassClaimError";
  }
}

export type PurchasePeekPassResult =
  | { kind: "purchased"; price: number; balanceAfter: number; expiresAt: Date }
  | { kind: "no_wallet" }
  | { kind: "insufficient"; balance: number }
  | { kind: "active"; expiresAt: Date }
  | { kind: "quote_changed"; quote: PeekPassPrice; quotedAt: Date };

export async function purchasePeekPass(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    quotedPrice: number;
    quotedAt: Date;
    now?: Date;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PurchasePeekPassResult> {
  const result = await purchasePeekPassInner(input, prismaClient);
  // Post-commit; the inner call has already resolved its transaction.
  bettingPeekPassesTotal.inc({ result: result.kind });
  if (result.kind === "purchased") {
    logBucksTransition({
      event: "bucks.peek_pass.purchased",
      serverId: input.serverId,
      actorDiscordId: input.discordId,
      payout: result.price,
      balanceAfter: result.balanceAfter,
      surface: "button",
    });
  }
  return result;
}

async function purchasePeekPassInner(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    quotedPrice: number;
    quotedAt: Date;
    now?: Date;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PurchasePeekPassResult> {
  const now = input.now ?? new Date();
  const account = await prismaClient.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    select: {
      id: true,
      balance: true,
      isHouse: true,
      peekPassExpiresAt: true,
    },
  });
  if (account === null || account.isHouse) {
    return { kind: "no_wallet" };
  }
  if (
    account.peekPassExpiresAt !== null &&
    account.peekPassExpiresAt.getTime() > now.getTime()
  ) {
    return { kind: "active", expiresAt: account.peekPassExpiresAt };
  }
  if (account.balance < MINIMUM_PRICE) {
    return { kind: "insufficient", balance: account.balance };
  }

  const expiresAt = new Date(now.getTime() + PEEK_PASS_DURATION_MS);
  try {
    return await prismaClient.$transaction(async (tx) => {
      // FIRST statement: claim an inactive pass and lock the account row —
      // a concurrent claim re-evaluates against the committed claim and
      // matches 0 rows.
      const claimed = await tx.bucksAccount.updateMany({
        where: {
          id: account.id,
          serverId: input.serverId,
          discordId: input.discordId,
          isHouse: false,
          balance: { gte: MINIMUM_PRICE },
          OR: [
            { peekPassExpiresAt: null },
            { peekPassExpiresAt: { lte: now } },
          ],
        },
        data: { peekPassExpiresAt: expiresAt },
      });
      if (claimed.count !== 1) {
        throw new PassClaimError();
      }

      const lockedAccount = await tx.bucksAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: { id: true, balance: true },
      });
      const currentPrice = await calculateForAccount(lockedAccount, now, tx);
      if (
        now.getTime() - input.quotedAt.getTime() >= PEEK_PASS_QUOTE_TTL_MS ||
        input.quotedAt.getTime() > now.getTime() ||
        currentPrice.price !== input.quotedPrice
      ) {
        throw new QuoteChangedError(currentPrice);
      }

      const context = {
        type: "peek_pass" as const,
        purchaserDiscordId: input.discordId,
        price: currentPrice.price,
        balanceBefore: currentPrice.balance,
        weightedAgeWeeks: currentPrice.weightedAgeWeeks,
        expiresAt: expiresAt.toISOString(),
      };
      const house = await ensureHouseAccountInTransaction(tx, input.serverId);
      const balanceAfter = await applyBucksDelta(tx, {
        bucksAccountId: account.id,
        delta: -currentPrice.price,
        kind: "peek_pass",
        context,
      });
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: currentPrice.price,
        kind: "peek_pass",
        context,
      });
      return {
        kind: "purchased",
        price: currentPrice.price,
        balanceAfter,
        expiresAt,
      };
    });
  } catch (error) {
    if (error instanceof QuoteChangedError) {
      return {
        kind: "quote_changed",
        quote: error.quote,
        quotedAt: now,
      };
    }
    if (error instanceof PassClaimError) {
      const current = await prismaClient.bucksAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: { balance: true, peekPassExpiresAt: true },
      });
      if (
        current.peekPassExpiresAt !== null &&
        current.peekPassExpiresAt.getTime() > now.getTime()
      ) {
        return { kind: "active", expiresAt: current.peekPassExpiresAt };
      }
      return { kind: "insufficient", balance: current.balance };
    }
    throw error;
  }
}
