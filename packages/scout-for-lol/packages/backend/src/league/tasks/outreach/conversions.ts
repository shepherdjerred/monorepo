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
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";
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
    select: { guildId: true, createdAt: true, ladderStage: true },
    orderBy: { createdAt: "asc" },
  });

  const messagedGuilds = new Set<string>();
  const conversionsByStage = new Map<number, number>();
  const credited = new Set<string>();

  for (const row of delivered) {
    const guildId = row.guildId;
    // The rung is read from the row, never reconstructed from position: a
    // bounced day-3 DM followed by a delivered day-14 DM is rung 2, and the
    // legacy ladder could deliver a lone `outreach_30d`. Counting position
    // would report conversions under the wrong message variant.
    const stage = row.ladderStage;
    if (guildId === null || stage === null) continue;
    messagedGuilds.add(guildId);

    // Credit a guild to at most one stage — the first that plausibly caused the
    // subscription — so one conversion can't be counted three times.
    if (credited.has(guildId)) continue;

    // Activation means the guild's FIRST subscription, not merely another one:
    // the legacy day-3 DM went to guilds that already had one or two, so "a
    // subscription appeared afterwards" would score an already-active guild as
    // a conversion.
    const firstSub = await prisma.subscription.findFirst({
      where: { serverId: DiscordGuildIdSchema.parse(guildId) },
      select: { createdTime: true },
      orderBy: { createdTime: "asc" },
    });
    if (
      firstSub !== null &&
      firstSub.createdTime > row.createdAt &&
      firstSub.createdTime.getTime() < row.createdAt.getTime() + WINDOW_MS
    ) {
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

  // Ladder distribution, derived per guild from the same audit rows.
  const installs = await prisma.guildInstall.findMany({
    where: { removedAt: null },
    select: { serverId: true, installedAt: true },
  });
  const guildsAtStage = new Map<number, number>();
  let exhausted = 0;
  for (const install of installs) {
    const state = await readOutreachState(
      prisma,
      DiscordGuildIdSchema.parse(install.serverId),
      install.installedAt,
    );
    guildsAtStage.set(
      state.lastLadderStage,
      (guildsAtStage.get(state.lastLadderStage) ?? 0) + 1,
    );
    if (state.spent >= NON_CORE_MESSAGE_BUDGET) exhausted += 1;
  }
  outreachStageGuilds.reset();
  for (let stage = 0; stage <= NON_CORE_MESSAGE_BUDGET; stage += 1) {
    outreachStageGuilds.set(
      { stage: stage.toString() },
      guildsAtStage.get(stage) ?? 0,
    );
  }
  outreachBudgetExhausted.set(exhausted);

  logger.info(
    `[Outreach] Conversion metrics updated — ${credited.size.toString()} converted guild(s) across ${messagedGuilds.size.toString()} messaged guild(s)`,
  );
}
