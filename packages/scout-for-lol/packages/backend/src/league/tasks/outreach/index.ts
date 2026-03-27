/**
 * Automated Outreach Task
 *
 * Sends lifecycle DMs to guild installers:
 * - 3-day nudge: Only for guilds that haven't completed setup
 * - 14-day feedback: Only for guilds that have completed setup (3+ subs)
 *
 * Scout is set-and-forget — post-setup silence is the happy path.
 * We only nudge users who haven't set up, and solicit feedback from those who have.
 */

import { type Client } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("outreach");

const SUPPORT_USER = "<@160509172704739328>";
const DM_FOOTER =
  "\n\n**Note:** Replies to this bot cannot be read. " +
  "If you need help with setup, troubleshooting, or have any feedback, " +
  "please DM " +
  SUPPORT_USER +
  " directly -- happy to help!";
const GETTING_STARTED = "https://scout-for-lol.com/getting-started/";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

async function getSubscriptionCount(serverId: DiscordGuildId): Promise<number> {
  return prisma.subscription.count({ where: { serverId } });
}

async function getCompetitionCount(serverId: DiscordGuildId): Promise<number> {
  return prisma.competition.count({
    where: { serverId, isCancelled: false },
  });
}

/**
 * 3-day nudge: Only send if the guild hasn't completed setup
 */
async function runThreeDayOutreach(client: Client): Promise<void> {
  const cutoff = new Date(Date.now() - THREE_DAYS_MS);

  const guilds = await prisma.guildInstall.findMany({
    where: {
      installedAt: { lte: cutoff },
      outreach3dSentAt: null,
    },
  });

  logger.info(
    `[Outreach] 3-day check: ${guilds.length.toString()} guild(s) eligible`,
  );

  for (const guild of guilds) {
    const guildId = DiscordGuildIdSchema.parse(guild.serverId);
    const subCount = await getSubscriptionCount(guildId);

    let message: string | undefined;

    if (subCount === 0) {
      message = truncateDiscordMessage(
        `👋 Hey there! Thanks for adding Scout for LoL to **${guild.serverName}**. ` +
          `Need help getting started? Use \`/subscription add\` to track your first player, ` +
          `or check out the getting started guide: ${GETTING_STARTED}` +
          DM_FOOTER,
      );
    } else if (subCount <= 2) {
      message = truncateDiscordMessage(
        `👋 Hey there! You've started setting up Scout for LoL on **${guild.serverName}**, nice! ` +
          `You can add more players with \`/subscription add\`.` +
          DM_FOOTER,
      );
    }
    // 3+ subs = they're set up, skip the nudge

    if (message !== undefined) {
      const userId = DiscordAccountIdSchema.parse(guild.addedByDiscordId);
      const sent = await sendDM(client, userId, message);
      logger.info(
        `[Outreach] 3-day DM to ${guild.addedByDiscordId} for ${guild.serverName}: ${sent ? "sent" : "failed"}`,
      );
    } else {
      logger.info(
        `[Outreach] 3-day skip for ${guild.serverName}: ${subCount.toString()} subs (already set up)`,
      );
    }

    // Mark as sent regardless (don't retry)
    await prisma.guildInstall.update({
      where: { id: guild.id },
      data: { outreach3dSentAt: new Date() },
    });
  }
}

/**
 * 14-day feedback: Only send if the guild HAS completed setup (3+ subs)
 */
async function runFourteenDayOutreach(client: Client): Promise<void> {
  const cutoff = new Date(Date.now() - FOURTEEN_DAYS_MS);

  const guilds = await prisma.guildInstall.findMany({
    where: {
      installedAt: { lte: cutoff },
      outreach14dSentAt: null,
    },
  });

  logger.info(
    `[Outreach] 14-day check: ${guilds.length.toString()} guild(s) eligible`,
  );

  for (const guild of guilds) {
    const guildId = DiscordGuildIdSchema.parse(guild.serverId);
    const subCount = await getSubscriptionCount(guildId);

    if (subCount >= 3) {
      const compCount = await getCompetitionCount(guildId);
      const compMention =
        compCount > 0 ? " and running competitions" : "";

      const message = truncateDiscordMessage(
        `👋 Hey there! You've been using Scout for LoL on **${guild.serverName}** for a couple weeks now${compMention}. ` +
          `How's it going? Any bugs or feature suggestions?` +
          DM_FOOTER,
      );

      const userId = DiscordAccountIdSchema.parse(guild.addedByDiscordId);
      const sent = await sendDM(client, userId, message);
      logger.info(
        `[Outreach] 14-day DM to ${guild.addedByDiscordId} for ${guild.serverName}: ${sent ? "sent" : "failed"}`,
      );
    } else {
      logger.info(
        `[Outreach] 14-day skip for ${guild.serverName}: ${subCount.toString()} subs (not enough setup for feedback request)`,
      );
    }

    // Mark as sent regardless
    await prisma.guildInstall.update({
      where: { id: guild.id },
      data: { outreach14dSentAt: new Date() },
    });
  }
}

/**
 * Main outreach task — runs both passes
 */
export async function runOutreach(client: Client): Promise<void> {
  logger.info("[Outreach] Starting outreach check");
  const startTime = Date.now();

  await runThreeDayOutreach(client);
  await runFourteenDayOutreach(client);

  const duration = Date.now() - startTime;
  logger.info(
    `[Outreach] ✅ Outreach check completed in ${duration.toString()}ms`,
  );
}
