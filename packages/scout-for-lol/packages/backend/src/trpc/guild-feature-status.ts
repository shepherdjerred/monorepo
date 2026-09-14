import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { isDevGuildOverrideGuild } from "#src/lib/discord-rest.ts";
import { installedGuildIdsAmong } from "#src/lib/discord/installed-guilds.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";

export type GuildFeatureStatus =
  | { state: "no_shared_guild"; guilds: [] }
  | { state: "feature_disabled"; guilds: [] }
  | {
      state: "available";
      guilds: { id: string; name: string; icon: string | null }[];
    };

/**
 * Non-throwing availability probe shared by guild-scoped consumer features
 * (hall.status, duel.status): the user's installed guilds filtered to those
 * where the feature is enabled, with the dev-login fixture guild honored on
 * both the presence and enablement checks so navigation and the feature gate
 * agree.
 */
export async function guildFeatureStatus(
  user: User,
  isEnabledForGuild: (guildId: DiscordGuildId) => Promise<boolean>,
): Promise<GuildFeatureStatus> {
  const userGuilds = await fetchUserGuildsForRequest(user);
  const installedGuildIds = await installedGuildIdsAmong(
    userGuilds.map((g) => g.id),
  );
  const present = userGuilds.filter(
    (g) => installedGuildIds.has(g.id) || isDevGuildOverrideGuild(g.id),
  );
  if (present.length === 0) {
    return { state: "no_shared_guild", guilds: [] };
  }
  const evaluations = await Promise.all(
    present.map(async (guild) => {
      const guildId = DiscordGuildIdSchema.parse(guild.id);
      const enabled =
        (await isEnabledForGuild(guildId)) || isDevGuildOverrideGuild(guild.id);
      return { guild, enabled };
    }),
  );
  const enabledGuilds = evaluations.flatMap((evaluation) =>
    evaluation.enabled ? [evaluation.guild] : [],
  );
  if (enabledGuilds.length === 0) {
    return { state: "feature_disabled", guilds: [] };
  }
  return {
    state: "available",
    guilds: enabledGuilds.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
    })),
  };
}
