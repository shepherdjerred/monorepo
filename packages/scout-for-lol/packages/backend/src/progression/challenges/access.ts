import { TRPCError } from "@trpc/server";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";

/**
 * Challenge templates are global, but rollout remains guild-scoped. A signed-in
 * user may use the global surface when at least one of their current Discord
 * guilds has challenge runs enabled.
 */
export async function assertChallengeRunsEnabled(user: User): Promise<void> {
  if (await challengeRunsEnabled(user)) return;
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Challenge runs are unavailable",
  });
}

export async function challengeRunsEnabled(user: User): Promise<boolean> {
  const guilds = await fetchUserGuildsForRequest(user);
  const decisions = await Promise.all(
    guilds.map((guild) =>
      isPolicyEnabled("challenge_runs_enabled", {
        server: DiscordGuildIdSchema.parse(guild.id),
      }),
    ),
  );
  return decisions.some(Boolean);
}
