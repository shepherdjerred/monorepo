/**
 * Outreach conversion attribution.
 *
 * Answers the question that had no answer before: does outreach actually cause
 * anyone to configure Scout? Producing these numbers previously required
 * hand-joining `DmAuditLog` against `Subscription.createdTime` in SQL, so the
 * fact that the 30-day nudge was 0-for-27 went unnoticed for months.
 *
 * A guild counts as converted for a stage if it created its first subscription
 * within {@link ATTRIBUTION_WINDOW_DAYS} of a *delivered* message at that
 * stage. Attribution is deliberately generous on the window and strict on
 * delivery: crediting a message that bounced would flatter the numbers.
 */

import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  outreachBudgetExhausted,
  outreachConversionsTotal,
  outreachStageGuilds,
} from "#src/metrics/outreach.ts";
import { NON_CORE_MESSAGE_BUDGET } from "#src/discord/utils/message-budget.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("outreach-conversions");

export const ATTRIBUTION_WINDOW_DAYS = 7;
const WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const OUTREACH_KINDS = [
  "outreach_nudge",
  "outreach_last_call",
  "outreach_3d",
  "outreach_14d",
  "outreach_30d",
];

/**
 * Recompute conversion and ladder-distribution gauges from the audit log.
 *
 * Runs on a schedule rather than incrementally so it is self-healing: a missed
 * run or a restart cannot leave the numbers permanently skewed.
 */
export async function updateOutreachConversionMetrics(): Promise<void> {
  const delivered = await prisma.dmAuditLog.findMany({
    where: { deliveryStatus: "sent", kind: { in: OUTREACH_KINDS } },
    select: { guildId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Nth delivered message to a guild == ladder stage N.
  const stageByGuild = new Map<string, number>();
  const conversionsByStage = new Map<number, number>();
  const credited = new Set<string>();

  for (const row of delivered) {
    const guildId = row.guildId;
    if (guildId === null) continue;

    const stage = (stageByGuild.get(guildId) ?? 0) + 1;
    stageByGuild.set(guildId, stage);

    // Credit a guild to at most one stage — the first that plausibly caused the
    // subscription — so one conversion can't be counted three times.
    if (credited.has(guildId)) continue;

    const firstSubAfter = await prisma.subscription.findFirst({
      where: {
        serverId: DiscordGuildIdSchema.parse(guildId),
        createdTime: {
          gt: row.createdAt,
          lt: new Date(row.createdAt.getTime() + WINDOW_MS),
        },
      },
      select: { id: true },
    });
    if (firstSubAfter !== null) {
      credited.add(guildId);
      conversionsByStage.set(stage, (conversionsByStage.get(stage) ?? 0) + 1);
    }
  }

  outreachConversionsTotal.reset();
  for (let stage = 1; stage <= NON_CORE_MESSAGE_BUDGET; stage += 1) {
    outreachConversionsTotal.set(
      { stage: stage.toString() },
      conversionsByStage.get(stage) ?? 0,
    );
  }

  const installs = await prisma.guildInstall.groupBy({
    by: ["outreachStage"],
    where: { removedAt: null },
    _count: { _all: true },
  });
  outreachStageGuilds.reset();
  for (let stage = 0; stage <= NON_CORE_MESSAGE_BUDGET; stage += 1) {
    const row = installs.find((entry) => entry.outreachStage === stage);
    outreachStageGuilds.set({ stage: stage.toString() }, row?._count._all ?? 0);
  }
  outreachBudgetExhausted.set(
    installs
      .filter((entry) => entry.outreachStage >= NON_CORE_MESSAGE_BUDGET)
      .reduce((total, entry) => total + entry._count._all, 0),
  );

  logger.info(
    `[Outreach] Conversion metrics updated — ${credited.size.toString()} converted guild(s) across ${stageByGuild.size.toString()} messaged guild(s)`,
  );
}
