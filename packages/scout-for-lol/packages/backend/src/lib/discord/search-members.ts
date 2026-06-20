/**
 * Guild-member typeahead for the web UI's add/invite flows. Backed by
 * discord.js `guild.members.fetch({ query, limit })`, which performs a
 * gateway member-search (prefix match on username/nickname) and does NOT
 * require the privileged GuildMembers intent for the query-based form.
 *
 * Guild-admin gated; fail-soft (returns [] on any error) so a flaky search
 * never breaks the form.
 */

import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { client as discordClient } from "#src/discord/client.ts";
import { assertGuildAdmin } from "#src/trpc/guild-guard.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-search-members");

export const SearchMembersInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(25).default(10),
});
export type SearchMembersInput = z.infer<typeof SearchMembersInputSchema>;

export type SearchedMember = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
};

export async function searchGuildMembers(
  user: User,
  input: SearchMembersInput,
): Promise<SearchedMember[]> {
  await assertGuildAdmin({ user, guildId: input.guildId });

  const guild = discordClient.guilds.cache.get(input.guildId);
  if (guild === undefined) return [];

  try {
    const members = await guild.members.fetch({
      query: input.query,
      limit: input.limit,
    });
    return members.map((member) => ({
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
      avatar: member.displayAvatarURL(),
    }));
  } catch (error) {
    logger.warn("Guild member search failed", {
      guildId: input.guildId,
      error,
    });
    return [];
  }
}
