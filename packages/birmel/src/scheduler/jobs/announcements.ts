import type { TextChannel } from "discord.js";
import { getDiscordClient } from "../../discord/index.js";
import { getDatabase } from "../../database/index.js";
import { logger } from "../../utils/index.js";

type ScheduledAnnouncement = {
  id: number;
  guild_id: string;
  channel_id: string;
  message: string;
  scheduled_at: string;
  sent_at: string | null;
  repeat_interval: string | null; // 'daily', 'weekly', 'monthly', or null for one-time
  created_by: string;
};

/**
 * Creates the scheduled_announcements table if it doesn't exist
 */
export function ensureAnnouncementsTable(): void {
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS scheduled_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message TEXT NOT NULL,
      scheduled_at DATETIME NOT NULL,
      sent_at DATETIME,
      repeat_interval TEXT,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_announcements_scheduled
    ON scheduled_announcements(scheduled_at)
    WHERE sent_at IS NULL
  `);
}

/**
 * Schedule a new announcement
 */
export function scheduleAnnouncement(
  guildId: string,
  channelId: string,
  message: string,
  scheduledAt: Date,
  createdBy: string,
  repeatInterval?: "daily" | "weekly" | "monthly",
): number {
  const db = getDatabase();
  ensureAnnouncementsTable();

  const result = db.run(
    `INSERT INTO scheduled_announcements (guild_id, channel_id, message, scheduled_at, repeat_interval, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      channelId,
      message,
      scheduledAt.toISOString(),
      repeatInterval ?? null,
      createdBy,
    ],
  );

  logger.info("Scheduled announcement", {
    id: result.lastInsertRowid,
    guildId,
    channelId,
    scheduledAt: scheduledAt.toISOString(),
  });

  return Number(result.lastInsertRowid);
}

/**
 * Cancel a scheduled announcement
 */
export function cancelAnnouncement(id: number, guildId: string): boolean {
  const db = getDatabase();

  const result = db.run(
    "DELETE FROM scheduled_announcements WHERE id = ? AND guild_id = ? AND sent_at IS NULL",
    [id, guildId],
  );

  if (result.changes > 0) {
    logger.info("Cancelled announcement", { id, guildId });
    return true;
  }

  return false;
}

/**
 * List pending announcements for a guild
 */
export function listPendingAnnouncements(
  guildId: string,
): { id: number; message: string; scheduledAt: string; channelId: string }[] {
  const db = getDatabase();
  ensureAnnouncementsTable();

  const announcements = db
    .query<ScheduledAnnouncement, [string]>(
      `SELECT * FROM scheduled_announcements
       WHERE guild_id = ? AND sent_at IS NULL
       ORDER BY scheduled_at ASC`,
    )
    .all(guildId);

  return announcements.map((a) => ({
    id: a.id,
    message: a.message.substring(0, 100) + (a.message.length > 100 ? "..." : ""),
    scheduledAt: a.scheduled_at,
    channelId: a.channel_id,
  }));
}

/**
 * Send a single announcement
 */
async function sendAnnouncement(announcement: ScheduledAnnouncement): Promise<void> {
  try {
    const client = getDiscordClient();
    const channel = await client.channels.fetch(announcement.channel_id);

    if (!channel?.isTextBased()) {
      logger.warn("Announcement channel not found or not text-based", {
        id: announcement.id,
        guildId: announcement.guild_id,
        channelId: announcement.channel_id,
      });
      return;
    }

    await (channel as TextChannel).send(announcement.message);

    // Mark as sent
    const db = getDatabase();
    db.run("UPDATE scheduled_announcements SET sent_at = datetime('now') WHERE id = ?", [
      announcement.id,
    ]);

    // If repeating, schedule the next one
    if (announcement.repeat_interval) {
      const nextDate = new Date(announcement.scheduled_at);

      switch (announcement.repeat_interval) {
        case "daily":
          nextDate.setDate(nextDate.getDate() + 1);
          break;
        case "weekly":
          nextDate.setDate(nextDate.getDate() + 7);
          break;
        case "monthly":
          nextDate.setMonth(nextDate.getMonth() + 1);
          break;
      }

      scheduleAnnouncement(
        announcement.guild_id,
        announcement.channel_id,
        announcement.message,
        nextDate,
        announcement.created_by,
        announcement.repeat_interval as "daily" | "weekly" | "monthly",
      );
    }

    logger.info("Sent announcement", {
      id: announcement.id,
      guildId: announcement.guild_id,
    });
  } catch (error) {
    logger.error("Failed to send announcement", error as Error, {
      id: announcement.id,
      guildId: announcement.guild_id,
    });
  }
}

/**
 * Run the announcements job - checks for and sends due announcements
 */
export async function runAnnouncementsJob(): Promise<void> {
  try {
    const db = getDatabase();
    ensureAnnouncementsTable();

    // Find announcements that are due
    const dueAnnouncements = db
      .query<ScheduledAnnouncement, []>(
        `SELECT * FROM scheduled_announcements
         WHERE sent_at IS NULL AND scheduled_at <= datetime('now')
         ORDER BY scheduled_at ASC`,
      )
      .all();

    if (dueAnnouncements.length === 0) {
      return;
    }

    logger.info("Processing due announcements", { count: dueAnnouncements.length });

    for (const announcement of dueAnnouncements) {
      await sendAnnouncement(announcement);
    }
  } catch (error) {
    logger.error("Announcements job failed", error as Error);
  }
}
