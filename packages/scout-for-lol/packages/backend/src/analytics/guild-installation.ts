import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export async function findAnalyticsGuildInstallation(
  db: ExtendedPrismaClient,
  rawGuildId: string,
) {
  const guildId = DiscordGuildIdSchema.safeParse(rawGuildId);
  if (!guildId.success) return null;
  return await db.guildInstall.findUnique({
    where: { serverId: guildId.data },
    select: {
      serverId: true,
      analyticsInstallationId: true,
      analyticsLifecycleTracked: true,
    },
  });
}
