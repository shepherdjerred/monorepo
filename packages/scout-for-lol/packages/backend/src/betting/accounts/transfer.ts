import {
  BUCKS_INT32_MAX,
  BucksLedgerContextSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  MINIMUM_BUCKS_TRANSFER,
} from "#src/betting/constants.ts";
import {
  applyBucksDelta,
  BucksStorageOverflowError,
  InsufficientBucksError,
  lockBucksAccountsForCredit,
} from "#src/betting/ledger.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { bettingTransfersTotal } from "#src/metrics/betting.ts";

export const BucksTransferAmountSchema = z
  .number()
  .int()
  .min(MINIMUM_BUCKS_TRANSFER)
  .max(BUCKS_INT32_MAX);

export type BucksTransferSplit = {
  recipientAmount: number;
  feeAmount: number;
};

export function splitBucksTransferAmount(amount: number): BucksTransferSplit {
  const totalAmount = BucksTransferAmountSchema.parse(amount);
  return {
    recipientAmount: Math.floor(totalAmount / 2),
    feeAmount: Math.ceil(totalAmount / 2),
  };
}

export type TransferBucksInput = {
  serverId: DiscordGuildId;
  senderDiscordId: DiscordAccountId;
  recipientDiscordId: DiscordAccountId;
  recipientIsBot: boolean;
  amount: number;
};

export type TransferBucksResult =
  | {
      kind: "transferred";
      transferId: string;
      totalAmount: number;
      recipientAmount: number;
      feeAmount: number;
      balanceAfter: number;
    }
  | { kind: "feature_disabled" }
  | { kind: "invalid_amount" }
  | { kind: "same_user" }
  | { kind: "recipient_bot" }
  | { kind: "sender_not_found" }
  | { kind: "recipient_not_found" }
  | { kind: "recipient_is_house" }
  | { kind: "insufficient"; balance: number; needed: number }
  | { kind: "storage_limit" };

type TransferBucksDependencies = {
  prismaClient: ExtendedPrismaClient;
  isPolicyEnabled: typeof isPolicyEnabled;
  createTransferId: () => string;
};

const defaultDependencies: TransferBucksDependencies = {
  prismaClient: prisma,
  isPolicyEnabled,
  createTransferId: () => crypto.randomUUID(),
};

function observeTransfer(
  input: TransferBucksInput,
  result: TransferBucksResult,
): void {
  bettingTransfersTotal.inc({ result: result.kind });
  if (result.kind === "transferred") {
    logBucksTransition({
      event: "bucks.transfer.completed",
      serverId: input.serverId,
      actorDiscordId: input.senderDiscordId,
      recipientDiscordId: input.recipientDiscordId,
      stake: result.totalAmount,
      payout: result.recipientAmount,
      fee: result.feeAmount,
      balanceAfter: result.balanceAfter,
      surface: "command",
    });
    return;
  }
  logBucksTransition({
    event: "bucks.transfer.rejected",
    serverId: input.serverId,
    actorDiscordId: input.senderDiscordId,
    recipientDiscordId: input.recipientDiscordId,
    stake: input.amount,
    reason: result.kind,
    surface: "command",
  });
}

export async function transferBucks(
  input: TransferBucksInput,
  dependencies: TransferBucksDependencies = defaultDependencies,
): Promise<TransferBucksResult> {
  const [bettingEnabled, transfersEnabled] = await Promise.all([
    dependencies.isPolicyEnabled("betting_enabled", {
      server: input.serverId,
    }),
    dependencies.isPolicyEnabled("bucks_transfers_enabled", {
      server: input.serverId,
    }),
  ]);
  if (!bettingEnabled || !transfersEnabled) {
    const result = { kind: "feature_disabled" } as const;
    observeTransfer(input, result);
    return result;
  }

  const amountResult = BucksTransferAmountSchema.safeParse(input.amount);
  if (!amountResult.success) {
    const result = { kind: "invalid_amount" } as const;
    observeTransfer(input, result);
    return result;
  }
  if (input.senderDiscordId === input.recipientDiscordId) {
    const result = { kind: "same_user" } as const;
    observeTransfer(input, result);
    return result;
  }
  if (input.recipientIsBot) {
    const result = { kind: "recipient_bot" } as const;
    observeTransfer(input, result);
    return result;
  }

  const [sender, recipient, house] = await Promise.all([
    dependencies.prismaClient.bucksAccount.findUnique({
      where: {
        serverId_discordId: {
          serverId: input.serverId,
          discordId: input.senderDiscordId,
        },
      },
      select: { id: true, balance: true, isHouse: true },
    }),
    dependencies.prismaClient.bucksAccount.findUnique({
      where: {
        serverId_discordId: {
          serverId: input.serverId,
          discordId: input.recipientDiscordId,
        },
      },
      select: { id: true, isHouse: true },
    }),
    dependencies.prismaClient.bucksAccount.findUnique({
      where: {
        serverId_discordId: {
          serverId: input.serverId,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
      select: { id: true, isHouse: true },
    }),
  ]);

  if (sender === null || sender.isHouse) {
    const result = { kind: "sender_not_found" } as const;
    observeTransfer(input, result);
    return result;
  }
  if (recipient === null) {
    const result = { kind: "recipient_not_found" } as const;
    observeTransfer(input, result);
    return result;
  }
  if (recipient.isHouse) {
    const result = { kind: "recipient_is_house" } as const;
    observeTransfer(input, result);
    return result;
  }
  if (house?.isHouse !== true) {
    throw new Error(
      `Bryan Bucks house wallet is missing for ${input.serverId}`,
    );
  }

  const totalAmount = amountResult.data;
  const { recipientAmount, feeAmount } = splitBucksTransferAmount(totalAmount);
  if (recipientAmount + feeAmount !== totalAmount) {
    throw new Error("Bryan Bucks transfer split does not conserve value");
  }
  const transferId = z.uuid().parse(dependencies.createTransferId());
  const baseContext = {
    type: "transfer",
    transferId,
    senderAccountId: sender.id,
    recipientAccountId: recipient.id,
    houseAccountId: house.id,
    totalAmount,
    recipientAmount,
    feeAmount,
  } as const;

  try {
    const balanceAfter = await dependencies.prismaClient.$transaction(
      async (tx) => {
        const senderBalance = await applyBucksDelta(tx, {
          bucksAccountId: sender.id,
          delta: -totalAmount,
          kind: "transfer_sent",
          context: BucksLedgerContextSchema.parse({
            ...baseContext,
            role: "sender",
          }),
        });
        await lockBucksAccountsForCredit(tx, [recipient.id, house.id]);
        await applyBucksDelta(tx, {
          bucksAccountId: recipient.id,
          delta: recipientAmount,
          kind: "transfer_received",
          context: BucksLedgerContextSchema.parse({
            ...baseContext,
            role: "recipient",
          }),
        });
        await applyBucksDelta(tx, {
          bucksAccountId: house.id,
          delta: feeAmount,
          kind: "transfer_fee",
          context: BucksLedgerContextSchema.parse({
            ...baseContext,
            role: "house",
          }),
        });
        return senderBalance;
      },
    );
    const result: TransferBucksResult = {
      kind: "transferred",
      transferId,
      totalAmount,
      recipientAmount,
      feeAmount,
      balanceAfter,
    };
    observeTransfer(input, result);
    return result;
  } catch (error) {
    if (error instanceof InsufficientBucksError) {
      const current =
        await dependencies.prismaClient.bucksAccount.findUniqueOrThrow({
          where: { id: sender.id },
          select: { balance: true },
        });
      const result: TransferBucksResult = {
        kind: "insufficient",
        balance: current.balance,
        needed: totalAmount,
      };
      observeTransfer(input, result);
      return result;
    }
    if (error instanceof BucksStorageOverflowError) {
      const result = { kind: "storage_limit" } as const;
      observeTransfer(input, result);
      return result;
    }
    throw error;
  }
}
