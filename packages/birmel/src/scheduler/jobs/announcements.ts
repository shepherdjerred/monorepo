import type { TextChannel } from "discord.js";
import type { ScheduledAnnouncement } from "@prisma/client";
import { getDiscordClient } from "../../discord/index.js";
import { prisma } from "../../database/index.js";
import { logger } from "../../utils/index.js";

/**
 * Schedule a new announcement
 */
export async function scheduleAnnouncement(
  guildId: string,
  channelId: string,
  message: string,
  scheduledAt: Date,
  createdBy: string,
  repeat?: "daily" | "weekly" | "monthly",
): Promise<number> {
  const result = await prisma.scheduledAnnouncement.create({
    data: {
      guildId,
      channelId,
      message,
      scheduledAt,
      repeat: repeat ?? null,
      createdBy,
    },
  });

  logger.info("Scheduled announcement", {
    id: result.id,
    guildId,
    channelId,
    scheduledAt: scheduledAt.toISOString(),
  });

  return result.id;
}

/**
 * Cancel a scheduled announcement
 */
export async function cancelAnnouncement(
  id: number,
  guildId: string,
): Promise<boolean> {
  const result = await prisma.scheduledAnnouncement.deleteMany({
    where: {
      id,
      guildId,
      sentAt: null,
    },
  });

  if (result.count > 0) {
    logger.info("Cancelled announcement", { id, guildId });
    return true;
  }

  return false;
}

/**
 * List pending announcements for a guild
 */
export async function listPendingAnnouncements(
  guildId: string,
): Promise<
  { id: number; message: string; scheduledAt: Date; channelId: string }[]
> {
  const announcements = await prisma.scheduledAnnouncement.findMany({
    where: {
      guildId,
      sentAt: null,
    },
    orderBy: { scheduledAt: "asc" },
  });

  return announcements.map(
    (a: {
      id: number;
      message: string;
      scheduledAt: Date;
      channelId: string;
    }) => ({
      id: a.id,
      message: a.message.slice(0, 100) + (a.message.length > 100 ? "..." : ""),
      scheduledAt: a.scheduledAt,
      channelId: a.channelId,
    }),
  );
}

/**
 * Send a single announcement
 */
async function sendAnnouncement(
  announcement: ScheduledAnnouncement,
): Promise<void> {
  try {
    const client = getDiscordClient();
    const channel = await client.channels.fetch(announcement.channelId);

    if (!channel?.isTextBased()) {
      logger.warn("Announcement channel not found or not text-based", {
        id: announcement.id,
        guildId: announcement.guildId,
        channelId: announcement.channelId,
      });
      return;
    }

    await (channel as TextChannel).send(announcement.message);

    // Mark as sent
    await prisma.scheduledAnnouncement.update({
      where: { id: announcement.id },
      data: { sentAt: new Date() },
    });

    // If repeating, schedule the next one
    if (announcement.repeat) {
      const nextDate = new Date(announcement.scheduledAt);

      switch (announcement.repeat) {
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

      await scheduleAnnouncement(
        announcement.guildId,
        announcement.channelId,
        announcement.message,
        nextDate,
        announcement.createdBy,
        announcement.repeat as "daily" | "weekly" | "monthly",
      );
    }

    logger.info("Sent announcement", {
      id: announcement.id,
      guildId: announcement.guildId,
    });
  } catch (error) {
    logger.error("Failed to send announcement", error as Error, {
      id: announcement.id,
      guildId: announcement.guildId,
    });
  }
}

/**
 * Run the announcements job - checks for and sends due announcements
 */
export async function runAnnouncementsJob(): Promise<void> {
  try {
    // Find announcements that are due
    const dueAnnouncements = await prisma.scheduledAnnouncement.findMany({
      where: {
        sentAt: null,
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
    });

    if (dueAnnouncements.length === 0) {
      return;
    }

    logger.info("Processing due announcements", {
      count: dueAnnouncements.length,
    });

    for (const announcement of dueAnnouncements) {
      await sendAnnouncement(announcement);
    }
  } catch (error) {
    logger.error("Announcements job failed", error as Error);
  }
}
