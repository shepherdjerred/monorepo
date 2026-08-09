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
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { DiscordGuildId } from "@scout-for-lol/data";
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
 * Record a conversion for one guild if its first subscription of the current
 * installation landed inside the attribution window after a delivered message.
 *
 * Exported so `cleanupRemovedGuild` can materialize a pending conversion BEFORE
 * deleting the guild's subscriptions. The nightly job alone was not enough: a
 * guild that converted and then removed Scout the same day lost the evidence
 * before the job ever looked, so short-lived activations vanished from the
 * experiment.
 */
export async function recordConversionIfAny(
  db: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  installedAt: Date,
): Promise<boolean> {
  const existing = await db.outreachConversion.findUnique({
    where: { serverId_installedAt: { serverId, installedAt } },
  });
  if (existing !== null) return false;

  const delivered = await db.dmAuditLog.findMany({
    where: {
      guildId: serverId,
      deliveryStatus: "sent",
      kind: { in: OUTREACH_KINDS },
      createdAt: { gte: installedAt },
    },
    select: { createdAt: true, ladderStage: true },
    orderBy: { createdAt: "asc" },
  });
  if (delivered.length === 0) return false;

  const firstSub = await db.subscription.findFirst({
    where: { serverId, createdTime: { gte: installedAt } },
    select: { createdTime: true },
    orderBy: { createdTime: "asc" },
  });
  if (firstSub === null) return false;

  for (const row of delivered) {
    const stage = row.ladderStage;
    if (stage === null) continue;
    if (
      firstSub.createdTime > row.createdAt &&
      firstSub.createdTime.getTime() < row.createdAt.getTime() + WINDOW_MS
    ) {
      await db.outreachConversion.create({
        data: { serverId, installedAt, ladderStage: stage },
      });
      return true;
    }
  }
  return false;
}

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

  const installs = await prisma.guildInstall.findMany({
    select: { serverId: true, installedAt: true },
  });
  // Plain-string keys: DmAuditLog.guildId is unbranded.
  const installedAtByGuild = new Map<string, Date>(
    installs.map((install) => [String(install.serverId), install.installedAt]),
  );

  // Detect NEW conversions and record them. Existing rows are never revisited:
  // the evidence (a subscription) can be deleted by cleanup when the guild
  // churns, so recomputing would make a historical result shrink over time.
  const recordedRows = await prisma.outreachConversion.findMany({
    select: { serverId: true, installedAt: true },
  });
  const alreadyRecorded = new Set(
    recordedRows.map(
      (row) => `${row.serverId}@${row.installedAt.toISOString()}`,
    ),
  );

  for (const row of delivered) {
    const guildId = row.guildId;
    // The rung is read from the row, never reconstructed from position: a
    // bounced day-3 DM followed by a delivered day-14 DM is rung 2, and the
    // legacy ladder could deliver a lone `outreach_30d`.
    const stage = row.ladderStage;
    if (guildId === null || stage === null) continue;

    const installedAt = installedAtByGuild.get(guildId);
    // Only messages belonging to the CURRENT installation can be credited.
    if (installedAt === undefined || row.createdAt < installedAt) continue;

    const key = `${guildId}@${installedAt.toISOString()}`;
    if (alreadyRecorded.has(key)) continue;

    // Activation means the guild's FIRST subscription of this installation, not
    // merely another one: the legacy day-3 DM went to guilds that already had
    // one or two, so "a subscription appeared afterwards" would score an
    // already-active guild as a conversion.
    const firstSub = await prisma.subscription.findFirst({
      where: {
        serverId: DiscordGuildIdSchema.parse(guildId),
        createdTime: { gte: installedAt },
      },
      select: { createdTime: true },
      orderBy: { createdTime: "asc" },
    });
    if (
      firstSub === null ||
      firstSub.createdTime <= row.createdAt ||
      firstSub.createdTime.getTime() >= row.createdAt.getTime() + WINDOW_MS
    ) {
      continue;
    }

    alreadyRecorded.add(key);
    await prisma.outreachConversion.create({
      data: {
        serverId: DiscordGuildIdSchema.parse(guildId),
        installedAt,
        ladderStage: stage,
      },
    });
  }

  const recorded = await prisma.outreachConversion.groupBy({
    by: ["ladderStage"],
    _count: { _all: true },
  });
  const conversionsByStage = new Map(
    recorded.map((entry) => [entry.ladderStage, entry._count._all]),
  );
  const credited = alreadyRecorded;
  const messagedGuilds = new Set(
    delivered.flatMap((row) => (row.guildId === null ? [] : [row.guildId])),
  );

  outreachConversionsTotal.reset();
  for (let stage = 1; stage <= NON_CORE_MESSAGE_BUDGET; stage += 1) {
    outreachConversionsTotal.set(
      { stage: stage.toString() },
      conversionsByStage.get(stage) ?? 0,
    );
  }

  // Ladder distribution, derived per guild from the same audit rows.
  const guildsAtStage = new Map<number, number>();
  let exhausted = 0;
  for (const install of installs) {
    const state = await readOutreachState(
      prisma,
      install.serverId,
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
