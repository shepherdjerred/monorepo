import type { TextChannel } from "discord.js";
import { getDiscordClient } from "../discord/index.js";
import { getDatabase } from "../database/index.js";
import { logger } from "../utils/index.js";
import { getRecentEvents } from "../database/repositories/server-events.js";

type DailyPostConfig = {
  id: number;
  guild_id: string;
  channel_id: string;
  enabled: number;
  post_time: string;
  timezone: string;
  last_post_at: string | null;
};

function getCurrentTimeInTimezone(timezone: string): { hours: number; minutes: number } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const hours = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minutes = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  return { hours, minutes };
}

function shouldPostNow(config: DailyPostConfig): boolean {
  // Check if already posted today
  if (config.last_post_at) {
    const lastPost = new Date(config.last_post_at);
    const now = new Date();

    // If posted within last 23 hours, skip
    const hoursSinceLastPost = (now.getTime() - lastPost.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastPost < 23) {
      return false;
    }
  }

  // Check if current time matches post time
  const timeParts = config.post_time.split(":");
  const postHour = parseInt(timeParts[0] ?? "0", 10);
  const postMinute = parseInt(timeParts[1] ?? "0", 10);
  const current = getCurrentTimeInTimezone(config.timezone);

  // Allow a 5-minute window for the scheduler
  const currentMinutes = current.hours * 60 + current.minutes;
  const postMinutes = postHour * 60 + postMinute;

  return currentMinutes >= postMinutes && currentMinutes < postMinutes + 5;
}

function generateDailyPost(guildId: string): string {
  // Get recent events for context
  const events = getRecentEvents(guildId, 50);

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
  try {
    const client = getDiscordClient();
    const channel = await client.channels.fetch(config.channel_id);

    if (!channel?.isTextBased()) {
      logger.warn("Daily post channel not found or not text-based", {
        guildId: config.guild_id,
        channelId: config.channel_id,
      });
      return;
    }

    const message = generateDailyPost(config.guild_id);
    await (channel as TextChannel).send(message);

    // Update last post time
    const db = getDatabase();
    db.run("UPDATE daily_post_config SET last_post_at = datetime('now') WHERE guild_id = ?", [
      config.guild_id,
    ]);

    logger.info("Sent daily post", { guildId: config.guild_id });
  } catch (error) {
    logger.error("Failed to send daily post", error, { guildId: config.guild_id });
  }
}

export async function checkAndSendDailyPosts(): Promise<void> {
  try {
    const db = getDatabase();

    const configs = db
      .query<DailyPostConfig, []>("SELECT * FROM daily_post_config WHERE enabled = 1")
      .all();

    for (const config of configs) {
      if (shouldPostNow(config)) {
        await sendDailyPost(config);
      }
    }
  } catch (error) {
    logger.error("Failed to check daily posts", error);
  }
}

export function configureDailyPost(
  guildId: string,
  channelId: string,
  options?: {
    postTime?: string;
    timezone?: string;
    enabled?: boolean;
  },
): void {
  const db = getDatabase();

  const existing = db
    .query<DailyPostConfig, [string]>("SELECT * FROM daily_post_config WHERE guild_id = ?")
    .get(guildId);

  if (existing) {
    db.run(
      `UPDATE daily_post_config
       SET channel_id = ?,
           post_time = COALESCE(?, post_time),
           timezone = COALESCE(?, timezone),
           enabled = COALESCE(?, enabled),
           updated_at = datetime('now')
       WHERE guild_id = ?`,
      [
        channelId,
        options?.postTime ?? null,
        options?.timezone ?? null,
        options?.enabled !== undefined ? (options.enabled ? 1 : 0) : null,
        guildId,
      ],
    );
  } else {
    db.run(
      `INSERT INTO daily_post_config (guild_id, channel_id, post_time, timezone, enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [
        guildId,
        channelId,
        options?.postTime ?? "09:00",
        options?.timezone ?? "UTC",
        options?.enabled !== undefined ? (options.enabled ? 1 : 0) : 1,
      ],
    );
  }

  logger.info("Configured daily post", { guildId, channelId, options });
}

export function disableDailyPost(guildId: string): void {
  const db = getDatabase();
  db.run("UPDATE daily_post_config SET enabled = 0 WHERE guild_id = ?", [guildId]);
  logger.info("Disabled daily post", { guildId });
}
