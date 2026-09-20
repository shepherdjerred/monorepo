import { TRPCError } from "@trpc/server";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { isDevGuildOverrideGuild } from "#src/lib/discord-rest.ts";
import {
  guildFeatureStatus,
  type GuildFeatureStatus,
} from "#src/trpc/guild-feature-status.ts";

export async function clashSurfaceStatus(
  user: User,
): Promise<GuildFeatureStatus> {
  return await guildFeatureStatus(
    user,
    async (guildId) =>
      await isPolicyEnabled("clash_surface", { server: guildId }),
  );
}

export async function assertClashSurfaceEnabled(user: User): Promise<void> {
  if (await clashSurfaceEnabled(user)) return;
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Clash is unavailable",
  });
}

export async function clashSurfaceEnabled(user: User): Promise<boolean> {
  const status = await clashSurfaceStatus(user);
  return status.state === "available";
}

export async function clashSnapshotEnabledGuildIds(): Promise<string[]> {
  const guilds = await prisma.player.findMany({
    distinct: ["serverId"],
    select: { serverId: true },
  });
  const enabled: string[] = [];
  for (const guild of guilds) {
    const parsed = DiscordGuildIdSchema.parse(guild.serverId);
    if (await isPolicyEnabled("clash_surface", { server: parsed })) {
      enabled.push(guild.serverId);
    }
  }
  return enabled;
}

export async function clashSurfaceEnabledForGuild(
  guildId: string,
): Promise<boolean> {
  const parsed = DiscordGuildIdSchema.parse(guildId);
  return (
    (await isPolicyEnabled("clash_surface", { server: parsed })) ||
    isDevGuildOverrideGuild(guildId)
  );
}

export async function assertClashSurfaceEnabledForGuild(
  guildId: string,
): Promise<void> {
  if (await clashSurfaceEnabledForGuild(guildId)) {
    return;
  }
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Clash is unavailable",
  });
}

/**
 * Explore tools, prematch Clash chrome, and puuid-gated canvas follow the
 * same fixture-guild exception as `clash.status`: the local dev-login guild
 * can use Clash without a static-flag override, so navigation never
 * advertises a surface the tools would then refuse.
 */
export async function clashExploreEnabled(
  guildIds: readonly string[],
): Promise<boolean> {
  const decisions = await Promise.all(
    guildIds.map((guildId) => clashSurfaceEnabledForGuild(guildId)),
  );
  return decisions.some(Boolean);
}

/**
 * Shared loading-screen artifacts only get Clash chrome when every guild
 * that tracks those puuids has `clash_surface`. A mixed audience therefore
 * stays on the ordinary canvas so a disabled guild never inherits Clash
 * styling from an enabled one.
 */
export async function clashSurfaceEnabledForPuuids(
  puuids: readonly string[],
): Promise<boolean> {
  if (puuids.length === 0) {
    return false;
  }
  const guilds = await prisma.account.findMany({
    where: { puuid: { in: [...puuids] } },
    distinct: ["serverId"],
    select: { serverId: true },
  });
  if (guilds.length === 0) {
    return false;
  }
  const decisions = await Promise.all(
    guilds.map((guild) => clashSurfaceEnabledForGuild(guild.serverId)),
  );
  return decisions.every(Boolean);
}
