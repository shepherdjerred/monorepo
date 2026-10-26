import {
  isPolicyEnabled,
  listGuildsWithFlagEnabled,
} from "#src/configuration/flags.ts";
import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
export type DareExploreCapability = {
  serverId: DiscordGuildId;
};

export async function resolveDareCapability(
  guildIds: readonly DiscordGuildId[],
): Promise<DareExploreCapability | null> {
  const declared = new Set<string>(listGuildsWithFlagEnabled("dares_enabled"));
  const candidates = guildIds.filter((guildId) => declared.has(guildId));
  const enabled: DiscordGuildId[] = [];
  for (const guildId of candidates) {
    const serverId = DiscordGuildIdSchema.parse(guildId);
    if (await isPolicyEnabled("dares_enabled", { server: serverId })) {
      enabled.push(serverId);
    }
  }
  if (enabled.length === 0) {
    return null;
  }
  const serverId = enabled[0];
  if (serverId === undefined || enabled.length > 1) {
    throw new Error(
      "Dare authoring requires exactly one enabled guild in scope; " +
        "add an explicit mapping before enabling a second guild.",
    );
  }
  return { serverId };
}
