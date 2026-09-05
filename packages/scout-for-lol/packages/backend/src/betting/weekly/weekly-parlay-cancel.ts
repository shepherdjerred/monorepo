import {
  deliverWeeklyParlayDiscord,
  weeklyParlaySettlementActionKey,
} from "#src/betting/weekly/weekly-parlay-discord.ts";
import { cancelWeeklyParlayMessage } from "#src/betting/weekly/weekly-parlay-refresh.ts";
import { settleWeeklyParlayMarket } from "#src/betting/weekly/weekly-parlay-settle.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export type WeeklyParlayCancellationDependencies = {
  prismaClient: ExtendedPrismaClient;
  deliverDiscord?: typeof deliverWeeklyParlayDiscord;
  cancelMessage?: typeof cancelWeeklyParlayMessage;
};

export type WeeklyParlayCancellationResult = {
  status: "reconciled" | "skipped";
  detail: string;
  marketId: number;
};

export async function cancelWeeklyParlayMarket(
  input: {
    marketId: number;
    marketState: string;
    voidReason: string | null;
    now: Date;
  },
  dependencies: WeeklyParlayCancellationDependencies,
): Promise<WeeklyParlayCancellationResult> {
  if (input.marketState === "settled") {
    return {
      status: "skipped",
      detail: "market_already_settled",
      marketId: input.marketId,
    };
  }
  if (
    input.marketState === "voided" &&
    input.voidReason !== "operator_cancelled"
  ) {
    return {
      status: "skipped",
      detail: "market_already_voided",
      marketId: input.marketId,
    };
  }
  const settlement =
    input.marketState === "voided"
      ? undefined
      : await settleWeeklyParlayMarket(
          {
            marketId: input.marketId,
            mode: "void",
            voidReason: "operator_cancelled",
            now: input.now,
          },
          dependencies.prismaClient,
        );
  const cancelled =
    await dependencies.prismaClient.bucksWeeklyParlayMarket.findUniqueOrThrow({
      where: { id: input.marketId },
      select: { marketState: true, voidReason: true },
    });
  if (
    cancelled.marketState !== "voided" ||
    cancelled.voidReason !== "operator_cancelled"
  ) {
    return {
      status: "skipped",
      detail: "market_not_cancelled",
      marketId: input.marketId,
    };
  }
  await (dependencies.deliverDiscord ?? deliverWeeklyParlayDiscord)(
    {
      marketId: input.marketId,
      actionKey: weeklyParlaySettlementActionKey(input.marketId),
      kind: "settlement",
      scheduledAt: input.now,
    },
    dependencies.prismaClient,
  );
  await (dependencies.cancelMessage ?? cancelWeeklyParlayMessage)(
    input.marketId,
    dependencies.prismaClient,
  );
  return {
    status: "reconciled",
    detail: settlement === undefined ? "already_cancelled" : "cancelled",
    marketId: input.marketId,
  };
}
