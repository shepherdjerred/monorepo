import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  WEEKLY_PARLAY_LIFECYCLE,
  WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS,
  WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS,
} from "@scout-for-lol/data/model/weekly-parlay.ts";
import {
  deliverWeeklyParlayDiscord,
  weeklyParlaySettlementActionKey,
} from "#src/betting/weekly-parlay-discord.ts";
import { openWeeklyParlay } from "#src/betting/weekly-parlay-open.ts";
import {
  WEEKLY_PARLAY_SLOT,
  weeklyParlayScoringShape,
  weeklyParlayScoringWindowForPeriod,
  weeklyParlayTimelineFromWindow,
  weeklyParlayPeriod,
  type WeeklyParlayFrozenWindow,
  type WeeklyParlayRuntimeTimeline,
} from "#src/betting/weekly-parlay-period.ts";
import { settleWeeklyParlayMarket } from "#src/betting/weekly-parlay-settle.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { bettingWeeklyParlayControlActionsTotal } from "#src/metrics/betting-weekly-parlay.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

export const WEEKLY_PARLAY_CONTROL_PATH =
  "/api/internal/weekly-parlays/actions";

export const WeeklyParlayCatchupWindowSchema = z.strictObject({
  kind: z.literal("catch_up"),
  openAt: z.iso.datetime(),
  bettingClosesAt: z.iso.datetime(),
  scoringStartsAt: z.iso.datetime(),
  scoringEndsAt: z.iso.datetime(),
});

export const WeeklyParlayControlActionSchema = z
  .strictObject({
    periodKey: z.iso.date(),
    slot: z.number().int().nonnegative().default(WEEKLY_PARLAY_SLOT),
    action: z.enum(["open", "reminder", "start", "progress", "finalize"]),
    updateIndex: z
      .number()
      .int()
      .min(0)
      .max(WEEKLY_PARLAY_LIFECYCLE.updateCount - 1)
      .optional(),
    window: WeeklyParlayCatchupWindowSchema.optional(),
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
    if (action.action !== "open" && action.window !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["window"],
        message: "Only open actions accept a catch-up window.",
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
  signal?: AbortSignal;
};

type PersistedMarket = {
  id: number;
  marketState: string;
  definition: {
    openAt: Date;
    bettingClosesAt: Date;
    scoringStartsAt: Date;
    scoringEndsAt: Date;
  };
};

function catchupTimeline(
  action: WeeklyParlayControlAction,
  now: Date,
): WeeklyParlayFrozenWindow {
  const custom = action.window;
  if (custom === undefined) {
    return weeklyParlayPeriod(action.periodKey);
  }
  const standard = weeklyParlayPeriod(action.periodKey);
  const timeline = {
    periodKey: action.periodKey,
    openAt: new Date(custom.openAt),
    bettingClosesAt: new Date(custom.bettingClosesAt),
    scoringStartsAt: new Date(custom.scoringStartsAt),
    scoringEndsAt: new Date(custom.scoringEndsAt),
  };
  const shape = weeklyParlayScoringShape(timeline);
  const canonicalScoringWindow = weeklyParlayScoringWindowForPeriod(
    action.periodKey,
    shape,
  );
  const minimumClose =
    timeline.openAt.getTime() +
    WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS +
    WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS;
  if (
    timeline.openAt > now ||
    timeline.openAt < standard.openAt ||
    timeline.bettingClosesAt.getTime() !== timeline.scoringStartsAt.getTime() ||
    timeline.bettingClosesAt.getTime() < minimumClose ||
    timeline.scoringStartsAt >= timeline.scoringEndsAt ||
    timeline.scoringStartsAt.getTime() !==
      canonicalScoringWindow.scoringStartsAt.getTime() ||
    timeline.scoringEndsAt.getTime() !== standard.scoringEndsAt.getTime() ||
    shape.startHour !== WEEKLY_PARLAY_LIFECYCLE.bettingCloseHour ||
    shape.startDayOffset < 0 ||
    shape.startDayOffset > 6 ||
    shape.endDayOffset !== 6 ||
    shape.endHour !== WEEKLY_PARLAY_LIFECYCLE.finalHour
  ) {
    throw new Error("Invalid weekly parlay catch-up timeline.");
  }
  return timeline;
}

function persistedTimeline(
  action: WeeklyParlayControlAction,
  market: PersistedMarket,
): WeeklyParlayRuntimeTimeline {
  return weeklyParlayTimelineFromWindow({
    periodKey: action.periodKey,
    ...market.definition,
  });
}

async function reconcileOpen(
  action: WeeklyParlayControlAction,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = catchupTimeline(action, context.now);
  if (
    context.now.getTime() + WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS >=
    period.bettingClosesAt.getTime()
  ) {
    return { status: "skipped", detail: "betting window already closed" };
  }
  const opened = await openWeeklyParlay(
    {
      serverId: context.serverId,
      periodKey: action.periodKey,
      slot: action.slot,
      timeline: period,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    },
    context.prismaClient,
  );
  if (opened.kind !== "created" && opened.kind !== "existing") {
    return { status: "skipped", detail: opened.kind };
  }
  if (context.now >= period.bettingClosesAt) {
    return {
      status: "skipped",
      detail: "betting window already closed",
      marketId: opened.marketId,
    };
  }
  if (context.signal?.aborted === true) {
    throw context.signal.reason ?? new Error("Weekly parlay open was aborted.");
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
  market: PersistedMarket,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = persistedTimeline(action, market);
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
  market: PersistedMarket,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = persistedTimeline(action, market);
  const marketId = market.id;
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
  market: PersistedMarket,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = persistedTimeline(action, market);
  if (context.now >= period.bettingClosesAt) {
    return { status: "skipped", detail: "stale_reminder", marketId: market.id };
  }
  if (market.marketState !== "open") {
    return {
      status: "skipped",
      detail: "market_not_open",
      marketId: market.id,
    };
  }
  if (period.reminderAt === undefined) {
    return { status: "skipped", detail: "no_reminder", marketId: market.id };
  }
  await deliverWeeklyParlayDiscord(
    {
      marketId: market.id,
      actionKey: actionKey(action),
      kind: "reminder",
      scheduledAt: period.reminderAt,
    },
    context.prismaClient,
  );
  return { status: "reconciled", detail: "reminded", marketId: market.id };
}

async function reconcileProgress(
  action: WeeklyParlayControlAction,
  market: PersistedMarket,
  context: ControlContext,
): Promise<WeeklyParlayControlResult> {
  const period = persistedTimeline(action, market);
  const marketId = market.id;
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
    signal?: AbortSignal;
  },
): Promise<WeeklyParlayControlResult> {
  const action = WeeklyParlayControlActionSchema.parse(input);
  const serverId = DiscordGuildIdSchema.parse(options.serverId);
  const prismaClient = options.prismaClient ?? prisma;
  const now = options.now ?? new Date();
  const context: ControlContext = {
    serverId,
    prismaClient,
    now,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
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
    select: {
      id: true,
      marketState: true,
      definition: {
        select: {
          openAt: true,
          bettingClosesAt: true,
          scoringStartsAt: true,
          scoringEndsAt: true,
        },
      },
    },
  });
  if (market === null) {
    return { status: "skipped", detail: "no_market" };
  }
  if (action.action === "start") {
    return await reconcileStart(action, market, context);
  }
  if (action.action === "finalize") {
    return await reconcileFinalize(action, market, context);
  }
  if (action.action === "reminder") {
    return await reconcileReminder(action, market, context);
  }
  return await reconcileProgress(action, market, context);
}

export async function runWeeklyParlayControlAction(
  input: WeeklyParlayControlAction,
  options: {
    serverId: string;
    now?: Date;
    prismaClient?: ExtendedPrismaClient;
    signal?: AbortSignal;
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
