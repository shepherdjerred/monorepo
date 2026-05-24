/**
 * Shared check for "the signed-in web user is an Administrator of the
 * target guild AND Scout is installed there." Mirrors the Discord-side
 * `setDefaultMemberPermissions(Administrator)` gate on /subscription *.
 */

import { TRPCError } from "@trpc/server";
import type { User } from "#generated/prisma/client/index.js";
import { fetchUserGuilds, hasAdministrator } from "#src/lib/discord-rest.ts";
import { client as discordClient } from "#src/discord/client.ts";

export async function assertGuildAdmin(params: {
  user: User;
  guildId: string;
}): Promise<void> {
  const guilds = await fetchUserGuilds(params.user);
  const match = guilds.find((g) => g.id === params.guildId);
  if (match === undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of that guild",
    });
  }
  if (!match.owner && !hasAdministrator(match.permissions)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator permission required",
    });
  }
  if (!discordClient.guilds.cache.has(params.guildId)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout is not installed in that guild",
    });
  }
}
