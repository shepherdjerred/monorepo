import * as Sentry from "@sentry/bun";
import { AttachmentBuilder } from "discord.js";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import {
  competitionChartToImage,
  type CompetitionChartProps,
} from "@scout-for-lol/report";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-balance-chart");

export const BALANCE_CHART_ATTACHMENT_NAME = "bryan-bucks-balance.png";

/**
 * Cap on plotted points. The ledger indexes `[bucksAccountId, createdAt]`, so
 * the read is cheap; the cap bounds the SVG, not the query. Points collapse to
 * one-per-day first (the last balance of each day is what a wallet "was"),
 * then thin evenly if a wallet somehow spans more than this many days.
 */
const MAX_CHART_POINTS = 200;

export type BalancePoint = { date: Date; value: number };

/** One balance-after-per-day series, oldest first. */
export function downsampleBalanceSeries(
  entries: readonly { createdAt: Date; balanceAfter: number }[],
): BalancePoint[] {
  const lastPerDay = new Map<string, BalancePoint>();
  for (const entry of entries) {
    const day = entry.createdAt.toISOString().slice(0, 10);
    lastPerDay.set(day, { date: entry.createdAt, value: entry.balanceAfter });
  }
  const daily = [...lastPerDay.values()];
  if (daily.length <= MAX_CHART_POINTS) {
    return daily;
  }
  const step = Math.ceil(daily.length / MAX_CHART_POINTS);
  const thinned = daily.filter((_point, index) => index % step === 0);
  const last = daily.at(-1);
  if (last !== undefined && thinned.at(-1) !== last) {
    thinned.push(last);
  }
  return thinned;
}

async function loadBalanceSeries(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId },
  prismaClient: ExtendedPrismaClient,
): Promise<BalancePoint[]> {
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
  const entries = await prismaClient.bucksLedgerEntry.findMany({
    where: { bucksAccountId: account.id },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, balanceAfter: true },
  });
  return downsampleBalanceSeries(entries);
}

/**
 * A PNG line chart of this wallet's balance over its whole history, attached
 * to `/bb balance`.
 *
 * Best-effort by contract: `/bb balance` is otherwise a pure database read,
 * and an ECharts/resvg failure must degrade to the embed without the picture,
 * never to an error reply. Fewer than two points draws no chart — a single
 * dot is not a history.
 */
export async function buildBalanceChartAttachment(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<AttachmentBuilder | null> {
  try {
    const points = await loadBalanceSeries(input, prismaClient);
    if (points.length < 2) {
      return null;
    }
    const first = points[0];
    const last = points.at(-1);
    if (first === undefined || last === undefined) {
      return null;
    }
    const props: CompetitionChartProps = {
      chartType: "line",
      title: "Bryan Bucks balance",
      yAxisLabel: "BB",
      series: [{ playerName: "Balance", points }],
      startDate: first.date,
      endDate: last.date,
    };
    const buffer = await competitionChartToImage(props);
    return new AttachmentBuilder(buffer, {
      name: BALANCE_CHART_ATTACHMENT_NAME,
    });
  } catch (error) {
    logger.error(
      `❌ Could not render the Bryan Bucks balance chart for ${input.discordId}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "betting-balance-chart" },
    });
    return null;
  }
}
