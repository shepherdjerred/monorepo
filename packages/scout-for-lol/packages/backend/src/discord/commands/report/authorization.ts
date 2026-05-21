import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { getLimit } from "#src/configuration/flags.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export function isReportManager(
  interaction: ChatInputCommandInteraction,
  report: { ownerId: string },
  userId: DiscordAccountId,
): boolean {
  const isOwner = report.ownerId === userId;
  const isAdmin =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
    false;
  return isOwner || isAdmin;
}

export async function canCreateAnotherUserReport(params: {
  prisma: ExtendedPrismaClient;
  serverId: DiscordGuildId;
  ownerId: DiscordAccountId;
}): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const serverLimit = getLimit("reports_per_server", {
    server: params.serverId,
    user: params.ownerId,
  });
  if (serverLimit !== "unlimited") {
    const activeServerReports = await params.prisma.report.count({
      where: {
        serverId: params.serverId,
        isEnabled: true,
        isSystemManaged: false,
      },
    });
    if (activeServerReports >= serverLimit) {
      return {
        allowed: false,
        reason: `This server already has ${activeServerReports.toString()}/${serverLimit.toString()} active user reports. Disable or delete one before creating another.`,
      };
    }
  }

  const ownerLimit = getLimit("reports_per_owner_per_server", {
    server: params.serverId,
    user: params.ownerId,
  });
  if (ownerLimit !== "unlimited") {
    const activeOwnerReports = await params.prisma.report.count({
      where: {
        serverId: params.serverId,
        ownerId: params.ownerId,
        isEnabled: true,
        isSystemManaged: false,
      },
    });
    if (activeOwnerReports >= ownerLimit) {
      return {
        allowed: false,
        reason: `You already have ${activeOwnerReports.toString()}/${ownerLimit.toString()} active reports in this server. Disable or delete one before creating another.`,
      };
    }
  }

  return { allowed: true };
}
