/**
 * Automated Outreach
 *
 * A three-message ladder, capped for life by the non-core message budget:
 *
 * | Stage | Earliest | Sent when                | Content                     |
 * | ----- | -------- | ------------------------ | --------------------------- |
 * | 1     | day 3    | nothing configured       | onboarding nudge            |
 * | 2     | day 14   | always (content adapts)  | feedback ask, or 2nd nudge  |
 * | 3     | day 30   | always (content adapts)  | final feedback ask, or last call |
 *
 * Three deliberate departures from the version this replaces, each fixing a
 * measured failure in prod:
 *
 * 1. **Budget is consumed only on delivery.** The old passes stamped their
 *    column "regardless" of the send outcome, which permanently burned 33 of 37
 *    guilds out of the feedback ask without ever messaging them.
 * 2. **Eligibility is re-evaluated, not marked once.** A guild that configures
 *    late, or becomes reachable late, still gets its message. The old one-shot
 *    gate meant a guild's state at one instant decided its fate forever.
 * 3. **The feedback bar is one subscription, not three.** With a median of ~4
 *    subscriptions per server, a three-sub gate excluded most of the people
 *    actually using the product — which is why only four feedback DMs were ever
 *    attempted.
 *
 * The feedback ask lives here rather than on the removal path because a DM sent
 * after the bot is kicked usually cannot be delivered at all (no mutual guild):
 * that route managed 1 delivery out of 15 attempts.
 */

import { type Client } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { sendDM, type DmKind } from "#src/discord/utils/dm.ts";
import { NON_CORE_MESSAGE_BUDGET } from "#src/discord/utils/message-budget.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { getFeedbackUrl } from "#src/discord/utils/feedback.ts";
import {
  outreachMessagesTotal,
  outreachSkippedTotal,
} from "#src/metrics/outreach.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("outreach");

const SUPPORT_USER = "<@160509172704739328>";
const GETTING_STARTED = "https://scout-for-lol.com/getting-started/";
const DASHBOARD = "https://scout-for-lol.com/app/";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ladder rungs by install age. The rung decides WHAT to say; the budget decides
 * WHETHER we may say it. These are deliberately independent — see
 * {@link ladderStageFor}.
 */
const STAGE_AGE_DAYS: readonly { stage: number; days: number }[] = [
  { stage: 3, days: 30 },
  { stage: 2, days: 14 },
  { stage: 1, days: 3 },
];

/**
 * The rung a guild has reached, from install age alone.
 *
 * Derived from the calendar rather than from messages sent, because a guild
 * that needs no message still advances through the ladder. Tying the rung to
 * the delivered-message count stranded configured guilds on rung 1 forever:
 * they were skipped (correctly) at day 3, which delivered nothing, which left
 * the counter at zero, which meant day 14 re-evaluated as rung 1 again and the
 * feedback ask was never reachable.
 */
export function ladderStageFor(ageDays: number): number {
  return STAGE_AGE_DAYS.find((rung) => ageDays >= rung.days)?.stage ?? 0;
}

/** A guild's current configuration, which decides the message content. */
type GuildState = {
  subscriptions: number;
  competitions: number;
};

type Plan =
  | { action: "send"; stage: number; kind: DmKind; message: string }
  | { action: "skip"; stage: number; reason: string };

function helpLine(): string {
  return (
    `\n\nNeed a hand? DM ${SUPPORT_USER} directly, or tell us how it's going: ` +
    getFeedbackUrl()
  );
}

function onboardingNudge(serverName: string, state: GuildState): string {
  if (state.subscriptions === 0) {
    return (
      `👋 Thanks for adding Scout to **${serverName}**! It isn't tracking anyone yet, ` +
      `so it won't post anything.\n\nAdd your first player from the dashboard: ${DASHBOARD}\n` +
      `Step-by-step guide: ${GETTING_STARTED}` +
      helpLine()
    );
  }
  return (
    `👋 You've made a start on Scout in **${serverName}** — nice.\n\n` +
    `Add more players from the dashboard (${DASHBOARD}) and Scout will post a report ` +
    `after each of their games.` +
    helpLine()
  );
}

function feedbackAsk(serverName: string, state: GuildState): string {
  const extra = state.competitions > 0 ? " and running competitions" : "";
  return (
    `👋 You've been using Scout in **${serverName}**${extra} for a couple of weeks now. ` +
    `How's it going?\n\nAnything broken, confusing, or missing? We read every reply here: ` +
    getFeedbackUrl() +
    `\n\nOr DM ${SUPPORT_USER} directly.`
  );
}

function lastCall(serverName: string): string {
  return (
    `👋 Scout has been in **${serverName}** for a month but still isn't set up, ` +
    `so it hasn't posted anything.\n\n` +
    `If you'd like to finish: ${DASHBOARD} (guide: ${GETTING_STARTED}).\n` +
    `If Scout isn't what you were after, no hard feelings — you can remove it any time, ` +
    `and we'd genuinely like to know why: ${getFeedbackUrl()}`
  );
}

/**
 * Decide what, if anything, to send to a guild right now.
 *
 * Pure given its inputs so the ladder is unit-testable without Discord or a
 * clock — the failure mode here is messaging real users, so the decision logic
 * deserves to be tested directly.
 */
export function planOutreach(params: {
  serverName: string;
  installedAt: Date;
  /** Non-core messages already DELIVERED — the spent budget. */
  outreachStage: number;
  /** Highest rung already delivered, so a rung is never repeated. */
  lastLadderStage: number;
  feedbackRequestedAt: Date | null;
  state: GuildState;
  now: Date;
}): Plan {
  const ageDays =
    (params.now.getTime() - params.installedAt.getTime()) / DAY_MS;
  const stage = ladderStageFor(ageDays);

  if (stage === 0) {
    return { action: "skip", stage: 1, reason: "too_soon" };
  }
  // A rung is said at most once. Without this, an unconfigured guild past day
  // 30 would re-send the last call every single day until the budget drained.
  if (stage <= params.lastLadderStage) {
    return { action: "skip", stage, reason: "stage_already_sent" };
  }
  if (params.outreachStage >= NON_CORE_MESSAGE_BUDGET) {
    return { action: "skip", stage, reason: "budget_exhausted" };
  }

  const configured =
    params.state.subscriptions > 0 || params.state.competitions > 0;

  if (configured) {
    // Rung 1 is purely a setup nudge, and a configured guild has nothing to be
    // nudged about. Skipping WITHOUT recording the rung is deliberate: the
    // guild stays eligible, so it still reaches the feedback ask at rung 2.
    if (stage === 1) {
      return { action: "skip", stage, reason: "configured" };
    }
    if (params.feedbackRequestedAt !== null) {
      return { action: "skip", stage, reason: "already_asked" };
    }
    return {
      action: "send",
      stage,
      kind: "feedback_request",
      message: truncateDiscordMessage(
        feedbackAsk(params.serverName, params.state),
      ),
    };
  }

  return {
    action: "send",
    stage,
    kind: stage >= 3 ? "outreach_last_call" : "outreach_nudge",
    message: truncateDiscordMessage(
      stage >= 3
        ? lastCall(params.serverName)
        : onboardingNudge(params.serverName, params.state),
    ),
  };
}

async function readGuildState(serverId: DiscordGuildId): Promise<GuildState> {
  const [subscriptions, competitions] = await Promise.all([
    prisma.subscription.count({ where: { serverId } }),
    prisma.competition.count({ where: { serverId, isCancelled: false } }),
  ]);
  return { subscriptions, competitions };
}

/**
 * Run the ladder over every install.
 *
 * @param dryRun when true, plan and log but send nothing and write nothing —
 *   used to validate the ladder against a copy of production before the first
 *   real fire, because the failure mode is messaging real people.
 */
export async function runOutreach(
  client: Client,
  options: { dryRun?: boolean } = {},
): Promise<void> {
  const dryRun = options.dryRun ?? false;
  logger.info(
    `[Outreach] Starting outreach check${dryRun ? " (DRY RUN — nothing will be sent)" : ""}`,
  );
  const startTime = Date.now();
  const now = new Date();

  const installs = await prisma.guildInstall.findMany({
    where: { removedAt: null },
  });

  let sent = 0;
  let skipped = 0;

  for (const install of installs) {
    const guildId = DiscordGuildIdSchema.parse(install.serverId);
    const state = await readGuildState(guildId);
    const plan = planOutreach({
      serverName: install.serverName,
      installedAt: install.installedAt,
      outreachStage: install.outreachStage,
      lastLadderStage: install.lastLadderStage,
      feedbackRequestedAt: install.feedbackRequestedAt,
      state,
      now,
    });

    if (plan.action === "skip") {
      skipped += 1;
      outreachSkippedTotal.inc({
        stage: plan.stage.toString(),
        reason: plan.reason,
      });
      logger.debug(
        `[Outreach] ${install.serverName}: stage ${plan.stage.toString()} skipped (${plan.reason})`,
      );
      continue;
    }

    if (dryRun) {
      logger.info(
        `[Outreach] DRY RUN would send stage ${plan.stage.toString()} (${plan.kind}) to ${install.addedByDiscordId} for ${install.serverName}`,
      );
      continue;
    }

    const status = await sendDM({
      client,
      userId: DiscordAccountIdSchema.parse(install.addedByDiscordId),
      message: plan.message,
      kind: plan.kind,
      guildId,
      budget: { guildId, serverName: install.serverName },
    });

    outreachMessagesTotal.inc({ stage: plan.stage.toString(), status });
    logger.info(
      `[Outreach] Stage ${plan.stage.toString()} (${plan.kind}) to ${install.addedByDiscordId} for ${install.serverName}: ${status}`,
    );

    if (status === "sent") {
      sent += 1;
      // Record the rung so it is never repeated. (sendDM owns the budget
      // counter; this is the ladder position, which is a different thing.)
      await prisma.guildInstall.update({
        where: { id: install.id },
        data: {
          lastLadderStage: plan.stage,
          ...(plan.kind === "feedback_request"
            ? { feedbackRequestedAt: new Date() }
            : {}),
        },
      });
    }
  }

  logger.info(
    `[Outreach] ✅ Completed in ${(Date.now() - startTime).toString()}ms — ${installs.length.toString()} guild(s) evaluated, ${sent.toString()} sent, ${skipped.toString()} skipped`,
  );
}
