import type { TextChannel } from "discord.js";
import type { DailyPostConfig } from "@prisma/client";
import { getDiscordClient } from "../discord/index.js";
import { prisma } from "../database/index.js";
import { loggers } from "../utils/index.js";
import { withSpan, captureException } from "../observability/index.js";

const logger = loggers.scheduler.child("daily-posts");

function getCurrentTimeInTimezone(timezone: string): { hours: number; minutes: number } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const hours = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minutes = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  return { hours, minutes };
}

function shouldPostNow(config: DailyPostConfig): boolean {
  // Check if already posted today
  if (config.lastPostAt) {
    const lastPost = config.lastPostAt;
    const now = new Date();

    // If posted within last 23 hours, skip
    const hoursSinceLastPost =
      (now.getTime() - lastPost.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastPost < 23) {
      return false;
    }
  }

  // Check if current time matches post time
  const timeParts = config.postTime.split(":");
  const postHour = Number.parseInt(timeParts[0] ?? "0", 10);
  const postMinute = Number.parseInt(timeParts[1] ?? "0", 10);
  const current = getCurrentTimeInTimezone(config.timezone);

  // Allow a 5-minute window for the scheduler
  const currentMinutes = current.hours * 60 + current.minutes;
  const postMinutes = postHour * 60 + postMinute;

  return currentMinutes >= postMinutes && currentMinutes < postMinutes + 5;
}

async function getRecentEvents(
  guildId: string,
  limit: number
): Promise<{ eventType: string; eventData: Record<string, unknown> }[]> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const events = await prisma.serverEvent.findMany({
    where: {
      guildId,
      createdAt: { gte: oneDayAgo },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return events.map((e: { eventType: string; eventData: string }) => ({
    eventType: e.eventType,
    eventData: JSON.parse(e.eventData) as Record<string, unknown>,
  }));
}

async function generateDailyPost(guildId: string): Promise<string> {
  // Get recent events for context
  const events = await getRecentEvents(guildId, 50);

  const eventSummaries = events.map((e) => {
    const data = e.eventData;
    const summaryValue = data["summary"];
    const summary =
      typeof summaryValue === "string" ? summaryValue : JSON.stringify(data);
    return `- ${e.eventType}: ${summary}`;
  });

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let message = `**Daily Update - ${dateStr}**\n\n`;

  if (eventSummaries.length > 0) {
    message += "**Recent Activity:**\n";
    message += eventSummaries.slice(0, 10).join("\n");
    message += "\n\n";
  } else {
    message += "No notable activity in the last 24 hours.\n\n";
  }

  message += "Have a great day! Use `/help` to see what I can do.";

  return message;
}

async function sendDailyPost(config: DailyPostConfig): Promise<void> {
  await withSpan("scheduler.sendDailyPost", { guildId: config.guildId }, async (span) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(config.channelId);

      if (!channel?.isTextBased()) {
        logger.warn("Daily post channel not found or not text-based", {
          guildId: config.guildId,
          channelId: config.channelId,
        });
        span.setAttribute("channel.valid", false);
        return;
      }

      span.setAttribute("channel.valid", true);
      const message = await generateDailyPost(config.guildId);
      span.setAttribute("message.length", message.length);
      await (channel as TextChannel).send(message);

      // Update last post time
      await prisma.dailyPostConfig.update({
        where: { guildId: config.guildId },
        data: { lastPostAt: new Date() },
      });

      logger.info("Sent daily post", { guildId: config.guildId });
    } catch (error) {
      logger.error("Failed to send daily post", error, { guildId: config.guildId });
      captureException(error as Error, {
        operation: "scheduler.sendDailyPost",
        discord: { guildId: config.guildId },
      });
    }
  });
}

export async function checkAndSendDailyPosts(): Promise<void> {
  await withSpan("scheduler.checkDailyPosts", { operation: "scheduler.daily-posts" }, async (span) => {
    try {
      const configs = await prisma.dailyPostConfig.findMany({
        where: { enabled: true },
      });

      span.setAttribute("config.count", configs.length);
      logger.debug("Checking daily posts", { configCount: configs.length });

      for (const config of configs) {
        if (shouldPostNow(config)) {
          await sendDailyPost(config);
        }
      }
    } catch (error) {
      logger.error("Failed to check daily posts", error);
      captureException(error as Error, {
        operation: "scheduler.checkAndSendDailyPosts",
      });
    }
  });
}

export async function configureDailyPost(
  guildId: string,
  channelId: string,
  options?: {
    postTime?: string;
    timezone?: string;
    enabled?: boolean;
  }
): Promise<void> {
  // Build update data, excluding undefined values
  const updateData: {
    channelId: string;
    postTime?: string;
    timezone?: string;
    enabled?: boolean;
  } = { channelId };

  if (options?.postTime !== undefined) {
    updateData.postTime = options.postTime;
  }
  if (options?.timezone !== undefined) {
    updateData.timezone = options.timezone;
  }
  if (options?.enabled !== undefined) {
    updateData.enabled = options.enabled;
  }

  await prisma.dailyPostConfig.upsert({
    where: { guildId },
    update: updateData,
    create: {
      guildId,
      channelId,
      postTime: options?.postTime ?? "09:00",
      timezone: options?.timezone ?? "UTC",
      enabled: options?.enabled ?? true,
    },
  });

  logger.info("Configured daily post", { guildId, channelId, options });
}

export async function disableDailyPost(guildId: string): Promise<void> {
  await prisma.dailyPostConfig.update({
    where: { guildId },
    data: { enabled: false },
  });
  logger.info("Disabled daily post", { guildId });
}
