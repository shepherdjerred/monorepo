import {
  BUCKS_INT32_MAX,
  type BucksVoidReason,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
} from "#src/betting/constants.ts";
import { settlementHouseCut } from "#src/betting/house-cut.ts";
import { refundableBucksHeldForAccounts } from "#src/betting/ledger.ts";
import {
  computeParimutuelPayouts,
  type ParimutuelBet,
} from "#src/betting/parimutuel.ts";
import type { Db } from "#src/lib/audit/index.ts";

export type SettlementBet = {
  betId: number;
  bucksAccountId: number;
  discordId: string;
  isHouse: boolean;
  predictedTeamId: number;
  stake: number;
  grossPayout: number;
  houseCut: number;
  payout: number;
  winnings: number;
  won: boolean;
  refunded: boolean;
  subjectPuuid: string;
};

export type PendingBetRow = {
  id: number;
  bucksAccountId: number;
  discordId: string;
  isHouse: boolean;
  predictedTeamId: number;
  stake: number;
  subjectPuuid: string;
  balance: number;
  refundableHeld: bigint;
};

export type SettlementAllocation = {
  bets: SettlementBet[];
  winnersPool: number;
  losersPool: number;
  houseCut: number;
  storageOverflow: boolean;
};

export async function loadPendingOutcomeBets(
  tx: Db,
  poolId: number,
): Promise<PendingBetRow[]> {
  const rows = await tx.bucksBet.findMany({
    where: { poolId, betOutcome: "pending" },
    select: {
      id: true,
      bucksAccountId: true,
      bucksAccount: {
        select: {
          discordId: true,
          serverId: true,
          isHouse: true,
          balance: true,
        },
      },
      predictedTeamId: true,
      stake: true,
      subjectPuuid: true,
    },
    orderBy: { id: "asc" },
  });
  const refundableByAccount = await refundableBucksHeldForAccounts(
    tx,
    rows.map((row) => ({
      id: row.bucksAccountId,
      serverId: row.bucksAccount.serverId,
      isHouse: row.bucksAccount.isHouse,
    })),
  );
  return rows.map((row) => {
    const refundableHeld = refundableByAccount.get(row.bucksAccountId);
    if (refundableHeld === undefined) {
      throw new Error(
        `Missing refundable holdings for Bucks account ${row.bucksAccountId.toString()}`,
      );
    }
    return {
      id: row.id,
      bucksAccountId: row.bucksAccountId,
      discordId: row.bucksAccount.discordId,
      isHouse: row.bucksAccount.isHouse,
      predictedTeamId: row.predictedTeamId,
      stake: row.stake,
      subjectPuuid: row.subjectPuuid,
      balance: row.bucksAccount.balance,
      refundableHeld,
    };
  });
}

/** Every stake handed straight back after a void or one-sided refund. */
export function refundAll(
  rows: readonly PendingBetRow[],
): SettlementAllocation {
  return {
    bets: rows.map((row) => ({
      betId: row.id,
      bucksAccountId: row.bucksAccountId,
      discordId: row.discordId,
      isHouse: row.isHouse,
      predictedTeamId: row.predictedTeamId,
      stake: row.stake,
      grossPayout: row.stake,
      houseCut: 0,
      payout: row.stake,
      winnings: 0,
      won: false,
      refunded: true,
      subjectPuuid: row.subjectPuuid,
    })),
    winnersPool: 0,
    losersPool: 0,
    houseCut: 0,
    storageOverflow: false,
  };
}

function allocateSettlement(input: {
  rows: readonly PendingBetRow[];
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
}): SettlementAllocation {
  if (input.voidReason !== undefined || input.winningTeamId === undefined) {
    return refundAll(input.rows);
  }

  const parimutuelInput: ParimutuelBet[] = input.rows.map((row) => ({
    betId: row.id,
    predictedTeamId: row.predictedTeamId,
    stake: row.stake,
  }));
  const result = computeParimutuelPayouts(parimutuelInput, input.winningTeamId);

  if (result.kind === "refund_all") {
    return refundAll(input.rows);
  }
  if (result.kind === "storage_overflow") {
    return { ...refundAll(input.rows), storageOverflow: true };
  }

  const byId = new Map(
    result.allocations.map((allocation) => [allocation.betId, allocation]),
  );
  const bets = input.rows.map((row) => {
    const allocation = byId.get(row.id);
    const grossPayout = allocation?.payout ?? 0;
    const grossWinnings = allocation?.winnings ?? 0;
    const houseCut = settlementHouseCut({
      grossPayout,
      grossWinnings,
      isHouse: row.isHouse,
    });
    return {
      betId: row.id,
      bucksAccountId: row.bucksAccountId,
      discordId: row.discordId,
      isHouse: row.isHouse,
      predictedTeamId: row.predictedTeamId,
      stake: row.stake,
      grossPayout,
      houseCut,
      payout: grossPayout - houseCut,
      winnings: grossWinnings - houseCut,
      won: allocation !== undefined,
      refunded: false,
      subjectPuuid: row.subjectPuuid,
    };
  });
  return {
    winnersPool: result.winnersPool,
    losersPool: result.losersPool,
    houseCut: bets.reduce((total, bet) => total + bet.houseCut, 0),
    storageOverflow: false,
    bets,
  };
}

function settlementCreditFits(row: PendingBetRow, payout: number): boolean {
  const otherHeld = row.refundableHeld - BigInt(row.stake);
  return (
    otherHeld >= 0n &&
    BigInt(row.balance) + BigInt(payout) + otherHeld <= BigInt(BUCKS_INT32_MAX)
  );
}

function bettorCreditsFit(
  rows: readonly PendingBetRow[],
  bets: readonly SettlementBet[],
): boolean {
  return bets.every((bet) => {
    const row = rows.find((candidate) => candidate.id === bet.betId);
    return row !== undefined && settlementCreditFits(row, bet.grossPayout);
  });
}

async function houseCreditHeadroom(
  tx: Db,
  input: {
    serverId: DiscordGuildId;
    pendingBets: readonly PendingBetRow[];
    settledBets: readonly SettlementBet[];
  },
): Promise<{ fits: boolean; refundableHeldAfterSettlement: bigint }> {
  const incoming = input.settledBets.reduce(
    (total, bet) =>
      total + BigInt(bet.houseCut) + BigInt(bet.isHouse ? bet.grossPayout : 0),
    0n,
  );
  if (incoming === 0n) {
    return { fits: true, refundableHeldAfterSettlement: 0n };
  }

  const house = await tx.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
      },
    },
    select: { id: true, balance: true },
  });
  if (house === null) {
    return {
      fits: BigInt(HOUSE_BANKROLL) + incoming <= BigInt(BUCKS_INT32_MAX),
      refundableHeldAfterSettlement: 0n,
    };
  }

  const refundableByAccount = await refundableBucksHeldForAccounts(tx, [
    { id: house.id, serverId: input.serverId, isHouse: true },
  ]);
  const refundableHeld = refundableByAccount.get(house.id);
  if (refundableHeld === undefined) {
    throw new Error(
      `Missing refundable holdings for house account ${house.id.toString()}`,
    );
  }
  const currentPoolHeld = input.pendingBets.reduce(
    (total, bet) =>
      total + BigInt(bet.bucksAccountId === house.id ? bet.stake : 0),
    0n,
  );
  const otherHeld = refundableHeld - currentPoolHeld;
  return {
    fits:
      otherHeld >= 0n &&
      BigInt(house.balance) + incoming + otherHeld <= BigInt(BUCKS_INT32_MAX),
    refundableHeldAfterSettlement: otherHeld,
  };
}

export async function planOutcomeSettlement(
  tx: Db,
  input: {
    serverId: DiscordGuildId;
    pendingBets: readonly PendingBetRow[];
    winningTeamId: number | undefined;
    voidReason: BucksVoidReason | undefined;
  },
): Promise<{
  voidReason: BucksVoidReason | undefined;
  settlement: SettlementAllocation;
  houseRefundableHeldAfterSettlement: bigint;
}> {
  const settlement = allocateSettlement({
    rows: input.pendingBets,
    winningTeamId: input.winningTeamId,
    voidReason: input.voidReason,
  });
  if (input.voidReason !== undefined) {
    return {
      voidReason: input.voidReason,
      settlement,
      houseRefundableHeldAfterSettlement: 0n,
    };
  }

  const houseHeadroom = await houseCreditHeadroom(tx, {
    serverId: input.serverId,
    pendingBets: input.pendingBets,
    settledBets: settlement.bets,
  });
  const creditsFit =
    bettorCreditsFit(input.pendingBets, settlement.bets) && houseHeadroom.fits;
  if (creditsFit && !settlement.storageOverflow) {
    return {
      voidReason: undefined,
      settlement,
      houseRefundableHeldAfterSettlement:
        houseHeadroom.refundableHeldAfterSettlement,
    };
  }

  return {
    voidReason: "storage_overflow",
    settlement: refundAll(input.pendingBets),
    houseRefundableHeldAfterSettlement:
      houseHeadroom.refundableHeldAfterSettlement,
  };
}
