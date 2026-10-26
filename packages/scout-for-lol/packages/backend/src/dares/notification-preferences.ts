import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
export type DareNotificationPreferences = {
  dareLifecycleDms: boolean;
  dareProgressDms: boolean;
};
export async function getDareNotificationPreferences(
  input: { serverId: DiscordGuildId; discordId: DiscordAccountId },
  database: ExtendedPrismaClient = prisma,
): Promise<DareNotificationPreferences> {
  const row = await database.dareNotificationPreference.findUnique({
    where: { serverId_discordId: input },
    select: { dareLifecycleDms: true, dareProgressDms: true },
  });
  return row ?? { dareLifecycleDms: true, dareProgressDms: true };
}
export async function updateDareNotificationPreferences(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    updates: Partial<DareNotificationPreferences>;
  },
  database: ExtendedPrismaClient = prisma,
): Promise<DareNotificationPreferences> {
  return await database.dareNotificationPreference.upsert({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    create: {
      serverId: input.serverId,
      discordId: input.discordId,
      ...input.updates,
    },
    update: input.updates,
    select: { dareLifecycleDms: true, dareProgressDms: true },
  });
}
