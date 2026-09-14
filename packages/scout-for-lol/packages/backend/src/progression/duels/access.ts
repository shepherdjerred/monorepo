import { TRPCError } from "@trpc/server";
import type { DiscordGuildId } from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";

export async function duelRolloutAllowed(
  guildId: DiscordGuildId,
): Promise<boolean> {
  return await isPolicyEnabled("duels_enabled", { server: guildId });
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
