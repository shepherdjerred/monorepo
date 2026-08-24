import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  deliverWeeklyParlayDiscord,
  weeklyParlaySettlementActionKey,
} from "#src/betting/weekly-parlay-discord.ts";
import { openWeeklyParlay } from "#src/betting/weekly-parlay-open.ts";
import {
  WEEKLY_PARLAY_SLOT,
  weeklyParlayPeriod,
} from "#src/betting/weekly-parlay-period.ts";
import { settleWeeklyParlayMarket } from "#src/betting/weekly-parlay-settle.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { bettingWeeklyParlayControlActionsTotal } from "#src/metrics/betting-weekly-parlay.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

export const WEEKLY_PARLAY_CONTROL_PATH =
  "/api/internal/weekly-parlays/actions";

export const WeeklyParlayControlActionSchema = z
  .strictObject({
    periodKey: z.iso.date(),
    slot: z.number().int().nonnegative().default(WEEKLY_PARLAY_SLOT),
    action: z.enum(["open", "reminder", "start", "progress", "finalize"]),
    updateIndex: z.number().int().min(0).max(5).optional(),
  })
  .superRefine((action, context) => {
    if (action.action === "progress" && action.updateIndex === undefined) {
      context.addIssue({
        code: "custom",
        path: ["updateIndex"],
        message: "Progress actions require an update index.",
      });
    }
    if (action.action !== "progress" && action.updateIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["updateIndex"],
        message: "Only progress actions accept an update index.",
      });
    }
  });
export type WeeklyParlayControlAction = z.infer<
  typeof WeeklyParlayControlActionSchema
>;

export type WeeklyParlayControlResult = {
  status: "reconciled" | "skipped";
  detail: string;
  marketId?: number;
};

function actionKey(action: WeeklyParlayControlAction): string {
  return `${action.periodKey}:${action.slot.toString()}:${action.action}:${action.updateIndex?.toString() ?? "-"}`;
}

type ControlContext = {
  serverId: string;
  now: Date;
  prismaClient: ExtendedPrismaClient;
};

async function reconcileOpen(
  action: WeeklyParlayControlAction,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = weeklyParlayPeriod(action.periodKey);
  if (context.now >= period.bettingClosesAt) {
    return { status: "skipped", detail: "betting window already closed" };
  }
  const opened = await openWeeklyParlay(
    {
      serverId: context.serverId,
      periodKey: action.periodKey,
      slot: action.slot,
    },
    context.prismaClient,
  );
  if (opened.kind !== "created" && opened.kind !== "existing") {
    return { status: "skipped", detail: opened.kind };
  }
  await deliverWeeklyParlayDiscord(
    {
      marketId: opened.marketId,
      actionKey: actionKey(action),
      kind: "open",
      scheduledAt: period.openAt,
    },
    context.prismaClient,
  );
  return {
    status: "reconciled",
    detail: opened.kind,
    marketId: opened.marketId,
  };
}

async function reconcileStart(
  action: WeeklyParlayControlAction,
  market: { id: number; marketState: string },
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = weeklyParlayPeriod(action.periodKey);
  if (market.marketState === "publishing") {
    await settleWeeklyParlayMarket(
      {
        marketId: market.id,
        mode: "void",
        voidReason: "infrastructure_failure",
        now: context.now,
      },
      context.prismaClient,
    );
    await deliverWeeklyParlayDiscord(
      {
        marketId: market.id,
        actionKey: weeklyParlaySettlementActionKey(market.id),
        kind: "settlement",
        scheduledAt: period.scoringStartsAt,
      },
      context.prismaClient,
    );
    return {
      status: "reconciled",
      detail: "publication_failed",
      marketId: market.id,
    };
  }
  const started = await context.prismaClient.bucksWeeklyParlayMarket.updateMany(
    {
      where: { id: market.id, marketState: "open" },
      data: { marketState: "active", updatedAt: context.now },
    },
  );
  if (started.count === 1) {
    logBucksTransition({
      event: "bucks.weekly_parlay.started",
      serverId: context.serverId,
      marketId: market.id,
      periodKey: action.periodKey,
      slot: action.slot,
      fromState: "open",
      toState: "active",
      surface: "cron",
    });
  }
  return { status: "reconciled", detail: "started", marketId: market.id };
}

async function reconcileFinalize(
  action: WeeklyParlayControlAction,
  marketId: number,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = weeklyParlayPeriod(action.periodKey);
  await settleWeeklyParlayMarket(
    { marketId, mode: "final", now: context.now },
    context.prismaClient,
  );
  const finalized =
    await context.prismaClient.bucksWeeklyParlayMarket.findUnique({
      where: { id: marketId },
      select: {
        marketState: true,
        deliveries: {
          where: { kind: "settlement", deliveryState: "delivered" },
          select: { id: true },
          take: 1,
        },
      },
    });
  if (
    finalized === null ||
    (finalized.marketState !== "settled" && finalized.marketState !== "voided")
  ) {
    return { status: "skipped", detail: "not_finalized", marketId };
  }
  if (finalized.deliveries.length === 0) {
    await deliverWeeklyParlayDiscord(
      {
        marketId,
        actionKey: weeklyParlaySettlementActionKey(marketId),
        kind: "settlement",
        scheduledAt: period.scoringEndsAt,
      },
      context.prismaClient,
    );
  }
  return { status: "reconciled", detail: "finalized", marketId };
}

async function reconcileReminder(
  action: WeeklyParlayControlAction,
  marketId: number,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = weeklyParlayPeriod(action.periodKey);
  if (context.now >= period.bettingClosesAt) {
    return { status: "skipped", detail: "stale_reminder", marketId };
  }
  await deliverWeeklyParlayDiscord(
    {
      marketId,
      actionKey: actionKey(action),
      kind: "reminder",
      scheduledAt: period.reminderAt,
    },
    context.prismaClient,
  );
  return { status: "reconciled", detail: "reminded", marketId };
}

async function reconcileProgress(
  action: WeeklyParlayControlAction,
  marketId: number,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = weeklyParlayPeriod(action.periodKey);
  const updateIndex = action.updateIndex;
  if (updateIndex === undefined) {
    throw new Error("A weekly progress action requires updateIndex.");
  }
  if (context.now >= period.scoringEndsAt) {
    return { status: "skipped", detail: "stale_progress", marketId };
  }
  const scheduledAt = period.updateAt[updateIndex];
  if (scheduledAt === undefined) {
    throw new Error("Weekly progress index has no scheduled wall time.");
  }
  const nextScheduledAt =
    period.updateAt[updateIndex + 1] ?? period.scoringEndsAt;
  if (context.now >= nextScheduledAt) {
    return { status: "skipped", detail: "stale_progress", marketId };
  }
  await deliverWeeklyParlayDiscord(
    {
      marketId,
      actionKey: actionKey(action),
      kind: "progress",
      scheduledAt,
    },
    context.prismaClient,
  );
  return { status: "reconciled", detail: "progressed", marketId };
}

async function runWeeklyParlayControlActionInternal(
  input: WeeklyParlayControlAction,
  options: {
    serverId: string;
    now?: Date;
    prismaClient?: ExtendedPrismaClient;
  },
): Promise<WeeklyParlayControlResult> {
  const action = WeeklyParlayControlActionSchema.parse(input);
  const serverId = DiscordGuildIdSchema.parse(options.serverId);
  const prismaClient = options.prismaClient ?? prisma;
  const now = options.now ?? new Date();
  const context = { serverId, prismaClient, now };
  if (action.action === "open") {
    return await reconcileOpen(action, context);
  }
  const market = await prismaClient.bucksWeeklyParlayMarket.findUnique({
    where: {
      serverId_periodKey_slot: {
        serverId,
        periodKey: action.periodKey,
        slot: action.slot,
      },
    },
    select: { id: true, marketState: true },
  });
  if (market === null) {
    return { status: "skipped", detail: "no_market" };
  }
  if (action.action === "start") {
    return await reconcileStart(action, market, context);
  }
  if (action.action === "finalize") {
    return await reconcileFinalize(action, market.id, context);
  }
  if (action.action === "reminder") {
    return await reconcileReminder(action, market.id, context);
  }
  return await reconcileProgress(action, market.id, context);
}

export async function runWeeklyParlayControlAction(
  input: WeeklyParlayControlAction,
  options: {
    serverId: string;
    now?: Date;
    prismaClient?: ExtendedPrismaClient;
  },
): Promise<WeeklyParlayControlResult> {
  try {
    const result = await runWeeklyParlayControlActionInternal(input, options);
    bettingWeeklyParlayControlActionsTotal.inc({
      action: input.action,
      result: result.status,
    });
    return result;
  } catch (error) {
    bettingWeeklyParlayControlActionsTotal.inc({
      action: input.action,
      result: "error",
    });
    throw error;
  }
}
