import { TRPCError } from "@trpc/server";
import type { DiscordGuildId } from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { isDevGuildOverrideGuild } from "#src/lib/discord-rest.ts";

/**
 * The dev-guild override keeps the gate aligned with `duel.status` (and with
 * `assertHallEnabled`): the dev-login/design-audit fixture guild can use
 * duels without a flag, so navigation never advertises a route the gate
 * would then refuse.
 */
export async function duelRolloutAllowed(
  guildId: DiscordGuildId,
): Promise<boolean> {
  return (
    (await isPolicyEnabled("duels_enabled", { server: guildId })) ||
    isDevGuildOverrideGuild(guildId)
  );
}

export async function assertDuelsEnabled(
  guildId: DiscordGuildId,
): Promise<void> {
  if (!(await duelRolloutAllowed(guildId))) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Duels are not enabled in this server",
    });
  }
}
